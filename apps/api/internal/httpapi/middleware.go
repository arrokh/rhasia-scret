package httpapi

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/labstack/echo/v5"
)

const (
	requestIDContextKey    = "requestId"
	proxyRequestContextKey = "proxyRequest"
)

const (
	corsAllowMethods  = "GET,POST,PATCH,PUT,DELETE,OPTIONS"
	corsAllowHeaders  = "content-type,authorization,if-none-match,if-match,x-request-id"
	corsExposeHeaders = "etag,last-modified,x-request-id,retry-after"
	corsMaxAge        = "600"
)

var opaqueRequestID = regexp.MustCompile(`(?i)^(?:[0-9a-f]{16,64}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$`)

type APIEventLogger interface {
	Log(level string, event string, fields map[string]any)
}

type JSONEventLogger struct {
	Info  io.Writer
	Warn  io.Writer
	Error io.Writer
	mu    sync.Mutex
}

func NewJSONEventLogger() *JSONEventLogger {
	return &JSONEventLogger{Info: os.Stdout, Warn: os.Stderr, Error: os.Stderr}
}

func (logger *JSONEventLogger) Log(level string, event string, fields map[string]any) {
	if logger == nil {
		return
	}
	output := logger.Info
	if level == "warn" {
		output = logger.Warn
	} else if level == "error" {
		output = logger.Error
	}
	if output == nil {
		return
	}

	values := make(map[string]any, len(fields)+1)
	values["event"] = event
	for key, value := range fields {
		if key != "event" {
			values[key] = value
		}
	}
	line, err := json.Marshal(values)
	if err != nil {
		return
	}

	logger.mu.Lock()
	defer logger.mu.Unlock()
	_, _ = output.Write(append(line, '\n'))
}

func RequestID(ctx *echo.Context) string {
	value, _ := ctx.Get(requestIDContextKey).(string)
	return value
}

func IsProxyRequest(ctx *echo.Context) bool {
	value, _ := ctx.Get(proxyRequestContextKey).(bool)
	return value
}

// RequestIDFromHeaders returns the one accepted opaque request ID or generates one.
func RequestIDFromHeaders(values []string) (string, error) {
	if len(values) == 1 && opaqueRequestID.MatchString(values[0]) {
		return values[0], nil
	}
	return newRequestID()
}

func noStoreResponses(next echo.HandlerFunc) echo.HandlerFunc {
	return func(ctx *echo.Context) error {
		header := ctx.Response().Header()
		if header.Get("Cache-Control") == "" {
			header.Set("Cache-Control", "no-store")
		}
		return next(ctx)
	}
}

func requestContext(next echo.HandlerFunc) echo.HandlerFunc {
	return func(ctx *echo.Context) error {
		requestID, err := RequestIDFromHeaders(ctx.Request().Header.Values("X-Request-Id"))
		if err != nil {
			return fmt.Errorf("generate request id: %w", err)
		}

		ctx.Set(requestIDContextKey, requestID)
		ctx.Set(proxyRequestContextKey, false)
		ctx.Response().Header().Set("X-Request-Id", requestID)
		return next(ctx)
	}
}

func newRequestID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(value[:])
	return encoded[:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:], nil
}

func proxyTrust(configuredSecret string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(ctx *echo.Context) error {
			values := ctx.Request().Header.Values("X-Rhasia-Proxy-Secret")
			if len(values) == 0 {
				return next(ctx)
			}
			if len(values) != 1 || !proxySecretValid(values[0], configuredSecret) {
				return ctx.JSON(http.StatusForbidden, ApiError{Error: "forbidden"})
			}
			ctx.Set(proxyRequestContextKey, true)
			return next(ctx)
		}
	}
}

func proxySecretValid(supplied string, configured string) bool {
	if configured == "" || len(supplied) != len(configured) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(supplied), []byte(configured)) == 1
}

func routeParameterValidation(next echo.HandlerFunc) echo.HandlerFunc {
	return func(ctx *echo.Context) error {
		pathValues := ctx.PathValues()
		if ctx.Request().URL.RawPath != "" {
			for index := range pathValues {
				value, err := url.PathUnescape(pathValues[index].Value)
				if err != nil {
					return ctx.JSON(http.StatusBadRequest, ApiError{Error: "invalid_request"})
				}
				pathValues[index].Value = value
			}
			ctx.SetPathValues(pathValues)
		}
		for _, parameter := range pathValues {
			if !ValidRouteParameter(parameter.Value) {
				return ctx.JSON(http.StatusBadRequest, ApiError{Error: "invalid_request"})
			}
		}
		return next(ctx)
	}
}

func NormalizeOrigin(raw string) (string, bool) {
	return normalizeOrigin(raw, false)
}

func NormalizeConfiguredOrigin(raw string) (string, bool) {
	return normalizeOrigin(raw, true)
}

func normalizeOrigin(raw string, allowRootPath bool) (string, bool) {
	value := raw
	if allowRootPath {
		value = strings.TrimSpace(value)
	} else if value != strings.TrimSpace(value) {
		return "", false
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed == nil || parsed.Opaque != "" || parsed.Hostname() == "" || parsed.User != nil ||
		parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" || parsed.RawFragment != "" ||
		(parsed.Path != "" && (!allowRootPath || parsed.Path != "/")) {
		return "", false
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return "", false
	}
	hostname := strings.ToLower(parsed.Hostname())
	port := parsed.Port()
	if scheme == "https" && port == "443" || scheme == "http" && port == "80" {
		port = ""
	}
	host := hostname
	if strings.Contains(hostname, ":") {
		host = "[" + hostname + "]"
	}
	if port != "" {
		host += ":" + port
	}
	return scheme + "://" + host, true
}

func exactOriginCORS(webOrigin string) echo.MiddlewareFunc {
	configuredOrigin, configured := NormalizeConfiguredOrigin(webOrigin)
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(ctx *echo.Context) error {
			header := ctx.Response().Header()
			origins := ctx.Request().Header.Values("Origin")
			origin := ""
			if len(origins) == 1 {
				origin = origins[0]
			}
			requestOrigin, validOrigin := NormalizeOrigin(origin)
			if configured && validOrigin && requestOrigin == configuredOrigin {
				header.Set("Access-Control-Allow-Origin", origin)
			}
			header.Set("Access-Control-Expose-Headers", corsExposeHeaders)
			header.Add("Vary", "Origin")

			if ctx.Request().Method == http.MethodOptions {
				header.Set("Access-Control-Max-Age", corsMaxAge)
				header.Set("Access-Control-Allow-Methods", corsAllowMethods)
				header.Set("Access-Control-Allow-Headers", corsAllowHeaders)
				header.Add("Vary", "Access-Control-Request-Headers")
				header.Del("Content-Length")
				header.Del("Content-Type")
				return ctx.NoContent(http.StatusNoContent)
			}

			return next(ctx)
		}
	}
}

type responseStatusWriter struct {
	http.ResponseWriter
	status int
}

func (writer *responseStatusWriter) WriteHeader(status int) {
	if writer.status == 0 {
		writer.status = status
	}
	writer.ResponseWriter.WriteHeader(status)
}

func (writer *responseStatusWriter) Write(body []byte) (int, error) {
	if writer.status == 0 {
		writer.WriteHeader(http.StatusOK)
	}
	return writer.ResponseWriter.Write(body)
}

func (writer *responseStatusWriter) Unwrap() http.ResponseWriter {
	return writer.ResponseWriter
}

type headResponseWriter struct {
	http.ResponseWriter
	wroteHeader bool
}

func (writer *headResponseWriter) WriteHeader(status int) {
	if writer.wroteHeader {
		return
	}
	writer.wroteHeader = true
	writer.ResponseWriter.WriteHeader(status)
}

func (writer *headResponseWriter) Write(body []byte) (int, error) {
	if !writer.wroteHeader {
		writer.WriteHeader(http.StatusOK)
	}
	return len(body), nil
}

func (writer *headResponseWriter) Unwrap() http.ResponseWriter {
	return writer.ResponseWriter
}

func headOnlyResponseBody(next echo.HandlerFunc) echo.HandlerFunc {
	return func(ctx *echo.Context) error {
		if ctx.Request().Method != http.MethodHead {
			return next(ctx)
		}
		ctx.SetResponse(&headResponseWriter{ResponseWriter: ctx.Response()})
		return next(ctx)
	}
}

func requestLogging(logger APIEventLogger) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(ctx *echo.Context) error {
			path := ctx.Path()
			if path == "" {
				path = "unmatched"
			}
			if path == "/v1/health" || path == "/v1/time" {
				return next(ctx)
			}

			startedAt := time.Now()
			statusWriter := &responseStatusWriter{ResponseWriter: ctx.Response()}
			ctx.SetResponse(statusWriter)
			err := next(ctx)
			status := statusWriter.status
			if err != nil {
				status = http.StatusInternalServerError
				if errors.Is(err, echo.ErrNotFound) || errors.Is(err, echo.ErrMethodNotAllowed) {
					status = http.StatusNotFound
				}
			} else if status == 0 {
				status = http.StatusOK
			}

			level := "info"
			if status >= http.StatusInternalServerError {
				level = "error"
			} else if status >= http.StatusBadRequest {
				level = "warn"
			}
			if logger != nil {
				logger.Log(level, "api_request", map[string]any{
					"requestId":  RequestID(ctx),
					"method":     ctx.Request().Method,
					"path":       path,
					"status":     status,
					"durationMs": time.Since(startedAt).Milliseconds(),
				})
			}
			return err
		}
	}
}
