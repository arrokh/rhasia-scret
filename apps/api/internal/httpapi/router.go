package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/labstack/echo/v5"
)

type RouterConfig struct {
	WebOrigin   string
	ProxySecret string
	Logger      APIEventLogger
}

func NewErrorRouter(config RouterConfig, status int, errorCode string) *echo.Echo {
	router := newRouter(config)
	router.Any("/*", func(ctx *echo.Context) error {
		return ctx.JSON(status, ApiError{Error: errorCode})
	})
	return router
}

func NewRouter(config RouterConfig, handlers map[string]OperationHandler) (*echo.Echo, error) {
	server, err := NewServer(handlers)
	if err != nil {
		return nil, err
	}
	router := newRouter(config)
	RegisterOperationHandlersWithBaseURL(router, server, "/v1")
	RegisterHeadHandlersWithBaseURL(router, server, "/v1")
	return router, nil
}

// NewSystemRouter serves database-independent health and time endpoints with the same HTTP middleware.
func NewSystemRouter(config RouterConfig, clock func() time.Time) *echo.Echo {
	if clock == nil {
		clock = time.Now
	}
	router := newRouter(config)
	handlers := SystemHandlers(clock)
	router.GET("/v1/health", echo.HandlerFunc(handlers["getHealth"]))
	router.GET("/v1/time", echo.HandlerFunc(handlers["getTime"]))
	router.HEAD("/v1/health", echo.HandlerFunc(handlers["getHealth"]))
	router.HEAD("/v1/time", echo.HandlerFunc(handlers["getTime"]))
	return router
}

func newRouter(config RouterConfig) *echo.Echo {
	logger := config.Logger
	if logger == nil {
		logger = NewJSONEventLogger()
	}
	router := echo.New()
	router.JSONSerializer = compatibilityJSONSerializer{delegate: router.JSONSerializer}
	router.HTTPErrorHandler = func(ctx *echo.Context, err error) {
		writeHTTPError(logger, err, ctx)
	}
	router.Use(
		headOnlyResponseBody,
		noStoreResponses,
		requestContext,
		requestLogging(logger),
		proxyTrust(config.ProxySecret),
		exactOriginCORS(config.WebOrigin),
		routeParameterValidation,
	)
	return router
}

func writeHTTPError(logger APIEventLogger, err error, ctx *echo.Context) {
	if responseHasStarted(ctx) {
		return
	}

	var httpError *echo.HTTPError
	if errors.Is(err, echo.ErrNotFound) || errors.Is(err, echo.ErrMethodNotAllowed) ||
		(errors.As(err, &httpError) && (httpError.Code == http.StatusNotFound || httpError.Code == http.StatusMethodNotAllowed)) {
		_ = ctx.JSON(http.StatusNotFound, ApiError{Error: "not_found"})
		return
	}

	if logger != nil {
		logger.Log("error", "api_internal_error", map[string]any{"requestId": RequestID(ctx)})
	}
	_ = ctx.JSON(http.StatusInternalServerError, ApiError{Error: "internal_error"})
}

func responseHasStarted(ctx *echo.Context) bool {
	writer := ctx.Response()
	for {
		if statusWriter, ok := writer.(*responseStatusWriter); ok {
			return statusWriter.status != 0
		}
		unwrapper, ok := writer.(interface{ Unwrap() http.ResponseWriter })
		if !ok {
			return false
		}
		writer = unwrapper.Unwrap()
	}
}
