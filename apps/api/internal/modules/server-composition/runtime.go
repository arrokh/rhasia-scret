package servercomposition

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/config"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	identityinfra "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity/infrastructure"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/postgres"
)

const (
	postgresStartupTimeout          = 5 * time.Second
	runtimeInitializationRetryDelay = postgresStartupTimeout
)

// ValidateEnvironment checks runtime configuration without opening a database connection.
func ValidateEnvironment(environment config.Environment) error {
	authConfiguration, err := readAuthConfiguration(environment)
	if err != nil {
		return err
	}
	if _, _, err := createEmailDelivery(environment, authConfiguration); err != nil {
		return err
	}
	return nil
}

type Runtime struct {
	Router *echo.Echo
	Pool   *pgxpool.Pool
}

// OpenRuntime creates the database-backed API. The API receives only DATABASE_URL;
// direct migration/admin URLs are intentionally not part of this configuration.
func OpenRuntime(environment config.Environment, logger httpapi.APIEventLogger) (*Runtime, error) {
	databaseURL, err := environment.RequireDatabaseURL()
	if err != nil {
		return nil, err
	}
	if _, err := readAuthConfiguration(environment); err != nil {
		return nil, err
	}
	pool, err := postgres.OpenPool(databaseURL)
	if err != nil {
		return nil, errors.New("API database pool could not be created")
	}
	startupContext, cancel := context.WithTimeout(context.Background(), postgresStartupTimeout)
	defer cancel()
	if err := pool.Ping(startupContext); err != nil {
		pool.Close()
		return nil, errors.New("API database is unavailable")
	}
	router, err := NewRouter(pool, environment, logger, time.Now)
	if err != nil {
		pool.Close()
		return nil, err
	}
	return &Runtime{Router: router, Pool: pool}, nil
}

func (runtime *Runtime) Close() {
	if runtime == nil || runtime.Pool == nil {
		return
	}
	runtime.Pool.Close()
	runtime.Pool = nil
}

// NewVercelHandler keeps the health/time probes independent from database startup
// and initializes the full runtime once per warm function instance for API traffic.
func NewVercelHandler(lookup config.LookupEnv, logger httpapi.APIEventLogger) http.Handler {
	return newVercelHandler(lookup, logger, OpenRuntime, time.Now)
}

type runtimeOpener func(config.Environment, httpapi.APIEventLogger) (*Runtime, error)

func newVercelHandler(lookup config.LookupEnv, logger httpapi.APIEventLogger, openRuntime runtimeOpener, now func() time.Time) http.Handler {
	if logger == nil {
		logger = httpapi.NewJSONEventLogger()
	}
	if openRuntime == nil {
		openRuntime = OpenRuntime
	}
	if now == nil {
		now = time.Now
	}
	environment, environmentErr := config.ReadEnvironment(lookup)
	if environmentErr == nil {
		environment.DeploymentTarget = "vercel"
	}
	if environmentErr == nil && isProductionDeployment(environment, lookup) {
		environment.NodeEnvironment = "production"
		environmentErr = config.ValidateProductionDeployment(environment)
		if environmentErr == nil {
			if _, err := postgres.ParseRuntimePoolConfig(environment.DatabaseURL); err != nil {
				environmentErr = errors.New("API deployment database configuration is invalid")
			}
		}
		if environmentErr == nil {
			environmentErr = ValidateEnvironment(environment)
		}
	}
	routerConfig := httpapi.RouterConfig{
		WebOrigin:   environment.WebOrigin,
		ProxySecret: environment.ProxySecret,
		Logger:      logger,
	}
	systemRouter := httpapi.NewSystemRouter(routerConfig, time.Now)
	apiUnavailableRouter := httpapi.NewErrorRouter(routerConfig, http.StatusServiceUnavailable, "api_misconfigured")
	authenticationUnavailableRouter := httpapi.NewErrorRouter(routerConfig, http.StatusServiceUnavailable, "authentication_misconfigured")
	var runtime *Runtime
	var runtimeErr error
	var runtimeRetryAt time.Time
	var runtimeMutex sync.Mutex
	var configurationFailureLogged sync.Once
	var runtimeFailureLogged sync.Once

	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		normalized := normalizeVercelRequest(request)
		if normalized.URL.Path == "/v1/health" || normalized.URL.Path == "/v1/time" ||
			!strings.HasPrefix(normalized.URL.Path, "/v1/") {
			systemRouter.ServeHTTP(writer, normalized)
			return
		}
		if environmentErr != nil {
			configurationFailureLogged.Do(func() {
				event := "api_runtime_configuration_invalid"
				if errors.Is(environmentErr, identityinfra.ErrAuthenticationConfiguration) {
					event = "api_authentication_misconfigured"
				}
				logger.Log("error", event, map[string]any{"requestId": "startup"})
			})
			if errors.Is(environmentErr, identityinfra.ErrAuthenticationConfiguration) {
				authenticationUnavailableRouter.ServeHTTP(writer, normalized)
				return
			}
			apiUnavailableRouter.ServeHTTP(writer, normalized)
			return
		}
		runtimeMutex.Lock()
		if runtime == nil && (runtimeErr == nil || !now().Before(runtimeRetryAt)) {
			runtime, runtimeErr = openRuntime(environment, logger)
			if runtimeErr != nil {
				runtimeRetryAt = now().Add(runtimeInitializationRetryDelay)
			}
		}
		activeRuntime, activeRuntimeErr := runtime, runtimeErr
		runtimeMutex.Unlock()
		if errors.Is(activeRuntimeErr, identityinfra.ErrAuthenticationConfiguration) {
			runtimeFailureLogged.Do(func() {
				logger.Log("error", "api_authentication_misconfigured", map[string]any{"requestId": "startup"})
			})
			authenticationUnavailableRouter.ServeHTTP(writer, normalized)
			return
		}
		if activeRuntimeErr != nil || activeRuntime == nil {
			runtimeFailureLogged.Do(func() {
				logger.Log("error", "api_runtime_unavailable", map[string]any{"requestId": "startup"})
			})
			apiUnavailableRouter.ServeHTTP(writer, normalized)
			return
		}
		activeRuntime.Router.ServeHTTP(writer, normalized)
	})
}

func isProductionDeployment(environment config.Environment, lookup config.LookupEnv) bool {
	if environment.NodeEnvironment == "production" {
		return true
	}
	if lookup == nil {
		return false
	}
	vercelEnvironment, _ := lookup("VERCEL_ENV")
	return vercelEnvironment == "production"
}

func normalizeVercelRequest(request *http.Request) *http.Request {
	path := request.URL.Path
	if path == "/api" || strings.HasPrefix(path, "/api/") {
		path = strings.TrimPrefix(path, "/api")
		if path == "" {
			path = "/"
		}
	}
	if path == "/health" || path == "/time" {
		path = "/v1" + path
	}
	clone := request.Clone(request.Context())
	urlCopy := *request.URL
	urlCopy.Path = path
	urlCopy.RawPath = ""
	clone.URL = &urlCopy
	return clone
}
