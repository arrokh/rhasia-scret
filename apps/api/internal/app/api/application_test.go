package servercomposition

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/config"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
)

func TestNewRouterRegistersEveryOpenAPIOperation(t *testing.T) {
	pool := &pgxpool.Pool{}
	router, err := NewRouter(pool, config.Environment{AuthBackend: "none", NodeEnvironment: "development"}, quietLogger(), time.Now)
	if err != nil {
		t.Fatalf("NewRouter() error = %v", err)
	}
	if router == nil {
		t.Fatal("NewRouter() returned a nil router")
	}
}

func TestAuthBackendNoneFailsClosedForApplicationRoutes(t *testing.T) {
	router, err := NewRouter(&pgxpool.Pool{}, config.Environment{
		AuthBackend: "none", NodeEnvironment: "development",
	}, quietLogger(), time.Now)
	if err != nil {
		t.Fatalf("NewRouter() error = %v", err)
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/me", nil))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusUnauthorized, response.Body.String())
	}
	if strings.TrimSpace(response.Body.String()) != `{"error":"unauthenticated"}` {
		t.Fatalf("body = %q", response.Body.String())
	}
}

func TestNewApplicationSessionVerifierUsesPasswordlessWhenE2EIsDisabled(t *testing.T) {
	verifier, err := newApplicationSessionVerifier(
		config.Environment{NodeEnvironment: "development", E2EBrowserTests: "0"},
		apiService.AuthConfiguration{
			Backend: apiService.AuthBackendPasswordless,
			Passwordless: &apiService.PasswordlessConfiguration{
				SessionSecret: []byte(strings.Repeat("x", 32)),
			},
		},
		nil,
		time.Now,
	)
	if err == nil || !strings.Contains(err.Error(), "passwordless session verifier is not configured") {
		t.Fatalf("disabled E2E session verifier error = %v; want passwordless verifier initialization error", err)
	}
	if verifier != nil {
		t.Fatalf("session verifier = %#v, want nil on invalid pool", verifier)
	}
}

func TestNewApplicationSessionVerifierUsesEnabledE2EVerifier(t *testing.T) {
	verifier, err := newApplicationSessionVerifier(
		config.Environment{
			NodeEnvironment: "development", E2EBrowserTests: "1", E2EBrowserTestUsers: "{}",
		},
		apiService.AuthConfiguration{Backend: apiService.AuthBackendPasswordless},
		nil,
		time.Now,
	)
	if err != nil {
		t.Fatalf("enabled E2E verifier error = %v", err)
	}
	if _, ok := verifier.(*apiService.E2ESessionVerifier); !ok {
		t.Fatalf("session verifier = %T, want *E2ESessionVerifier", verifier)
	}
}

func TestCreatePasskeyRecoveryWebAuthnPreservesOptionalConfiguration(t *testing.T) {
	if got := createPasskeyRecoveryWebAuthn(config.Environment{}); got != nil {
		t.Fatal("missing Passkey Recovery configuration should leave the feature unavailable")
	}
	if got := createPasskeyRecoveryWebAuthn(config.Environment{PasskeyRPID: "web.example.test"}); got != nil {
		t.Fatal("partial Passkey Recovery configuration should leave the feature unavailable")
	}
	if got := createPasskeyRecoveryWebAuthn(config.Environment{
		PasskeyRPID: "web.example.test", PasskeyOrigin: "https://web.example.test",
	}); got == nil {
		t.Fatal("valid Passkey Recovery configuration should create WebAuthn")
	}
}

func TestNewVercelHandlerMapsAuthenticationConfigurationErrors(t *testing.T) {
	values := map[string]string{
		"AUTH_BACKEND": "invalid-backend",
		"DATABASE_URL": "postgresql://synthetic:synthetic@127.0.0.1:54321/rhasia_test?sslmode=disable",
		"NODE_ENV":     "production",
		"WEB_ORIGIN":   "https://web.example.test",
		"PROXY_SECRET": strings.Repeat("p", 32),
		"CRON_SECRET":  strings.Repeat("c", 32),
	}
	handler := NewVercelHandler(func(name string) (string, bool) {
		value, ok := values[name]
		return value, ok
	}, quietLogger())
	request := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	request.Header.Set("Origin", "https://web.example.test")
	request.Header.Set("X-Request-Id", "0123456789abcdef0123456789abcdef")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusServiceUnavailable, response.Body.String())
	}
	if strings.TrimSpace(response.Body.String()) != `{"error":"authentication_misconfigured"}` {
		t.Fatalf("body = %q", response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", response.Header().Get("Cache-Control"))
	}
	if response.Header().Get("X-Request-Id") != "0123456789abcdef0123456789abcdef" {
		t.Fatalf("X-Request-Id = %q", response.Header().Get("X-Request-Id"))
	}
	if response.Header().Get("Access-Control-Allow-Origin") != "https://web.example.test" {
		t.Fatalf("Access-Control-Allow-Origin = %q", response.Header().Get("Access-Control-Allow-Origin"))
	}
	if strings.Contains(response.Body.String(), "invalid-backend") {
		t.Fatal("authentication configuration details were exposed")
	}
}

func TestVercelProductionEnvironmentFailsClosedBeforeRuntimeButKeepsSystemProbes(t *testing.T) {
	values := map[string]string{
		"NODE_ENV":     "development",
		"VERCEL_ENV":   "production",
		"AUTH_BACKEND": "none",
		"WEB_ORIGIN":   "https://web.example.test",
		"CRON_SECRET":  strings.Repeat("c", 32),
		"DATABASE_URL": "postgresql://synthetic:synthetic@127.0.0.1:54321/rhasia_test?sslmode=disable",
	}
	openAttempts := 0
	handler := newVercelHandler(func(name string) (string, bool) {
		value, ok := values[name]
		return value, ok
	}, quietLogger(), func(config.Environment, httpapi.APIEventLogger) (*Runtime, error) {
		openAttempts++
		return nil, errors.New("runtime must not start with invalid production config")
	}, time.Now)

	probe := request(handler, "/v1/health")
	if probe.Code != http.StatusOK || strings.TrimSpace(probe.Body.String()) != `{"status":"ok"}` {
		t.Fatalf("database-independent health response=%d %s", probe.Code, probe.Body.String())
	}
	apiRequest := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	apiRequest.Header.Set("Origin", "https://web.example.test")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, apiRequest)
	if response.Code != http.StatusServiceUnavailable || strings.TrimSpace(response.Body.String()) != `{"error":"api_misconfigured"}` || openAttempts != 0 {
		t.Fatalf("invalid production config response=%d %s runtime attempts=%d", response.Code, response.Body.String(), openAttempts)
	}
}

func TestVercelProductionTargetValidatesAuthDespiteDevelopmentNodeEnvironment(t *testing.T) {
	values := map[string]string{
		"NODE_ENV":          "development",
		"VERCEL_ENV":        "production",
		"DEPLOYMENT_TARGET": "selfhosted",
		"AUTH_BACKEND":      "none",
		"WEB_ORIGIN":        "https://web.example.test",
		"PROXY_SECRET":      strings.Repeat("p", 32),
		"CRON_SECRET":       strings.Repeat("c", 32),
		"DATABASE_URL":      "postgresql://synthetic:synthetic@127.0.0.1:54321/rhasia_test?sslmode=disable",
	}
	openAttempts := 0
	handler := newVercelHandler(func(name string) (string, bool) {
		value, ok := values[name]
		return value, ok
	}, quietLogger(), func(config.Environment, httpapi.APIEventLogger) (*Runtime, error) {
		openAttempts++
		return nil, errors.New("runtime must not start with invalid production auth")
	}, time.Now)
	apiRequest := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	apiRequest.Header.Set("Origin", "https://web.example.test")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, apiRequest)
	if response.Code != http.StatusServiceUnavailable || strings.TrimSpace(response.Body.String()) != `{"error":"authentication_misconfigured"}` || openAttempts != 0 {
		t.Fatalf("production auth response=%d %s runtime attempts=%d", response.Code, response.Body.String(), openAttempts)
	}
}

func TestNewVercelHandlerRetriesTransientRuntimeStartupFailure(t *testing.T) {
	now := time.Date(2026, time.July, 8, 9, 10, 11, 0, time.UTC)
	values := map[string]string{"AUTH_BACKEND": "none", "NODE_ENV": "development"}
	attempts := 0
	opener := func(_ config.Environment, _ httpapi.APIEventLogger) (*Runtime, error) {
		attempts++
		if attempts == 1 {
			return nil, errors.New("synthetic database unavailable")
		}
		return &Runtime{Router: httpapi.NewSystemRouter(httpapi.RouterConfig{}, time.Now)}, nil
	}
	handler := newVercelHandler(func(name string) (string, bool) {
		value, ok := values[name]
		return value, ok
	}, quietLogger(), opener, func() time.Time { return now })

	first := request(handler, "/v1/me")
	if first.Code != http.StatusServiceUnavailable || strings.TrimSpace(first.Body.String()) != `{"error":"api_misconfigured"}` || attempts != 1 {
		t.Fatalf("first runtime failure response=%d %s attempts=%d", first.Code, first.Body.String(), attempts)
	}
	withinBackoff := request(handler, "/v1/me")
	if withinBackoff.Code != http.StatusServiceUnavailable || attempts != 1 {
		t.Fatalf("runtime retried during backoff: response=%d %s attempts=%d", withinBackoff.Code, withinBackoff.Body.String(), attempts)
	}

	now = now.Add(runtimeInitializationRetryDelay)
	retried := request(handler, "/v1/me")
	if retried.Code != http.StatusNotFound || !strings.Contains(retried.Body.String(), "not_found") || attempts != 2 {
		t.Fatalf("runtime did not recover after backoff: response=%d %s attempts=%d", retried.Code, retried.Body.String(), attempts)
	}
}

func TestNewVercelHandlerServesSystemEndpointsWithoutDatabase(t *testing.T) {
	values := map[string]string{"AUTH_BACKEND": "none", "NODE_ENV": "production"}
	handler := NewVercelHandler(func(name string) (string, bool) {
		value, ok := values[name]
		return value, ok
	}, quietLogger())

	for _, test := range []struct {
		path       string
		body       string
		bodyPrefix string
	}{
		{path: "/v1/health", body: `{"status":"ok"}`},
		{path: "/api/health", body: `{"status":"ok"}`},
		{path: "/v1/time", bodyPrefix: `{"now":"`},
	} {
		response := request(handler, test.path)
		if response.Code != 200 {
			t.Fatalf("%s returned %d: %s", test.path, response.Code, response.Body.String())
		}
		if test.body != "" && response.Body.String() != test.body+"\n" {
			t.Fatalf("%s body = %q, want %q", test.path, response.Body.String(), test.body+"\n")
		}
		if test.bodyPrefix != "" && !strings.HasPrefix(response.Body.String(), test.bodyPrefix) {
			t.Fatalf("%s body = %q, missing time body prefix", test.path, response.Body.String())
		}
	}

	response := request(handler, "/")
	if response.Code != 404 {
		t.Fatalf("root returned %d, want 404", response.Code)
	}
}

type testLogger struct{}

func (testLogger) Log(string, string, map[string]any) {}

func quietLogger() httpapi.APIEventLogger { return testLogger{} }

func request(handler interface {
	ServeHTTP(http.ResponseWriter, *http.Request)
}, path string) *httptest.ResponseRecorder {
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
	return response
}
