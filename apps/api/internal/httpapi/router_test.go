package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v5"
)

func newTestRouter(t *testing.T, logger APIEventLogger, handlers map[string]OperationHandler, proxySecret string) *echo.Echo {
	t.Helper()
	router, err := NewRouter(RouterConfig{
		WebOrigin:   "https://web.example.test",
		ProxySecret: proxySecret,
		Logger:      logger,
	}, handlers)
	if err != nil {
		t.Fatalf("NewRouter(): %v", err)
	}
	return router
}

func TestRouterSetsNoStoreAndRequestIDOnSystemRoutes(t *testing.T) {
	t.Parallel()

	var info bytes.Buffer
	var warnings bytes.Buffer
	var errors bytes.Buffer
	logger := &JSONEventLogger{Info: &info, Warn: &warnings, Error: &errors}
	handlers := testOperationHandlers()
	for operationID, handler := range SystemHandlers(func() time.Time {
		return time.Date(2025, time.August, 12, 10, 11, 12, 345_987_000, time.UTC)
	}) {
		handlers[operationID] = handler
	}
	router := newTestRouter(t, logger, handlers, "synthetic-proxy-secret")
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("GET /v1/health status = %d; want %d", response.Code, http.StatusOK)
	}
	if got := response.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q; want no-store", got)
	}
	if !opaqueRequestID.MatchString(response.Header().Get("X-Request-Id")) {
		t.Fatalf("generated request id %q is invalid", response.Header().Get("X-Request-Id"))
	}
	var healthBody struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(response.Body).Decode(&healthBody); err != nil || healthBody.Status != "ok" {
		t.Fatalf("health response = %#v, %v; want status ok", healthBody, err)
	}

	timeResponse := httptest.NewRecorder()
	router.ServeHTTP(timeResponse, httptest.NewRequest(http.MethodGet, "/v1/time", nil))
	var timeBody struct {
		Now string `json:"now"`
	}
	if err := json.NewDecoder(timeResponse.Body).Decode(&timeBody); err != nil || timeBody.Now != "2025-08-12T10:11:12.345Z" {
		t.Fatalf("time response = %#v, %v; want millisecond UTC timestamp", timeBody, err)
	}
	if got := timeResponse.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("time Cache-Control = %q; want no-store", got)
	}
	if info.Len() != 0 || warnings.Len() != 0 || errors.Len() != 0 {
		t.Fatalf("system route should not be logged: info=%q warn=%q error=%q", info.String(), warnings.String(), errors.String())
	}
}

func TestRouterAcceptsOnlyOpaqueRequestIDsAndLogsNoRequestBody(t *testing.T) {
	t.Parallel()

	var info bytes.Buffer
	var warnings bytes.Buffer
	var errors bytes.Buffer
	logger := &JSONEventLogger{Info: &info, Warn: &warnings, Error: &errors}
	router := newTestRouter(t, logger, testOperationHandlers(), "synthetic-proxy-secret")
	request := httptest.NewRequest(
		http.MethodGet,
		"/v1/shared-vaults/cmweju2p5ylhi3oawdzlru7bz?token=synthetic-query",
		strings.NewReader("synthetic request body"),
	)
	request.Header.Set("X-Request-Id", "0123456789abcdef")
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if got := response.Header().Get("X-Request-Id"); got != "0123456789abcdef" {
		t.Fatalf("X-Request-Id = %q; want supplied opaque ID", got)
	}
	if strings.Contains(info.String()+warnings.String()+errors.String(), "synthetic request body") {
		t.Fatal("request logging must not include the request body")
	}
	logged := info.String()
	if !strings.Contains(logged, `"event":"api_request"`) {
		t.Fatalf("request log missing api_request event: %s", logged)
	}
	if !strings.Contains(logged, `"path":"/v1/shared-vaults/:vaultId"`) {
		t.Fatalf("request log must contain the matched route pattern: %s", logged)
	}
	if strings.Contains(logged, "cmweju2p5ylhi3oawdzlru7bz") || strings.Contains(logged, "synthetic-query") {
		t.Fatalf("request log contains user-provided path or query data: %s", logged)
	}

	invalidRequest := httptest.NewRequest(http.MethodGet, "/v1/not-a-route/synthetic-user?token=synthetic-query", nil)
	invalidRequest.Header.Set("X-Request-Id", "invalid id")
	invalidResponse := httptest.NewRecorder()
	router.ServeHTTP(invalidResponse, invalidRequest)
	if got := invalidResponse.Header().Get("X-Request-Id"); got == "invalid id" || !opaqueRequestID.MatchString(got) {
		t.Fatalf("invalid request ID was not replaced with an opaque ID: %q", got)
	}
	logged = info.String() + warnings.String() + errors.String()
	if !strings.Contains(logged, `"path":"unmatched"`) {
		t.Fatalf("unmatched request log must use a fixed label: %s", logged)
	}
	if strings.Contains(logged, "synthetic-user") || strings.Contains(logged, "synthetic-query") {
		t.Fatalf("unmatched request log contains user-provided path or query data: %s", logged)
	}
}

func TestRouterEnforcesProxySecretBeforeCORS(t *testing.T) {
	t.Parallel()

	var visited bool
	handlers := testOperationHandlers()
	handlers["getMe"] = func(ctx *echo.Context) error {
		visited = true
		return ctx.NoContent(http.StatusNoContent)
	}
	router := newTestRouter(t, nil, handlers, "synthetic-proxy-secret")
	request := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	request.Header.Set("Origin", "https://web.example.test")
	request.Header.Set("X-Rhasia-Proxy-Secret", "wrong-secret")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d; want %d", response.Code, http.StatusForbidden)
	}
	if visited {
		t.Fatal("handler ran despite invalid proxy secret")
	}
	if response.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("invalid proxy request must be rejected before CORS")
	}
	if got := response.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q; want no-store", got)
	}
	var body ApiError
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Error != "forbidden" {
		t.Fatalf("error = %q; want forbidden", body.Error)
	}
}

func TestRouterAppliesExactOriginCORSAndPreflightContract(t *testing.T) {
	t.Parallel()

	router := newTestRouter(t, nil, testOperationHandlers(), "synthetic-proxy-secret")
	allowedPreflight := httptest.NewRequest(http.MethodOptions, "/v1/me", nil)
	allowedPreflight.Header.Set("Origin", "https://web.example.test")
	allowedPreflight.Header.Set("Access-Control-Request-Method", "POST")
	allowedPreflight.Header.Set("Access-Control-Request-Headers", "content-type")
	allowedResponse := httptest.NewRecorder()
	router.ServeHTTP(allowedResponse, allowedPreflight)

	if allowedResponse.Code != http.StatusNoContent {
		t.Fatalf("allowed preflight status = %d; want %d", allowedResponse.Code, http.StatusNoContent)
	}
	if got := allowedResponse.Header().Get("Access-Control-Allow-Origin"); got != "https://web.example.test" {
		t.Fatalf("Access-Control-Allow-Origin = %q", got)
	}
	if got := allowedResponse.Header().Get("Access-Control-Allow-Methods"); got != corsAllowMethods {
		t.Fatalf("Access-Control-Allow-Methods = %q; want %q", got, corsAllowMethods)
	}
	if got := allowedResponse.Header().Get("Access-Control-Allow-Headers"); got != corsAllowHeaders {
		t.Fatalf("Access-Control-Allow-Headers = %q; want %q", got, corsAllowHeaders)
	}
	if got := allowedResponse.Header().Get("Access-Control-Max-Age"); got != corsMaxAge {
		t.Fatalf("Access-Control-Max-Age = %q; want %q", got, corsMaxAge)
	}
	if got := allowedResponse.Header().Get("Access-Control-Expose-Headers"); got != corsExposeHeaders {
		t.Fatalf("Access-Control-Expose-Headers = %q; want %q", got, corsExposeHeaders)
	}
	if allowedResponse.Body.Len() != 0 {
		t.Fatalf("preflight response body = %q; want empty", allowedResponse.Body.String())
	}

	disallowedPreflight := httptest.NewRequest(http.MethodOptions, "/v1/me", nil)
	disallowedPreflight.Header.Set("Origin", "https://other.example.test")
	disallowedResponse := httptest.NewRecorder()
	router.ServeHTTP(disallowedResponse, disallowedPreflight)
	if disallowedResponse.Code != http.StatusNoContent {
		t.Fatalf("disallowed preflight status = %d; want %d", disallowedResponse.Code, http.StatusNoContent)
	}
	if disallowedResponse.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("disallowed origin received Access-Control-Allow-Origin")
	}
	if got := disallowedResponse.Header().Get("Access-Control-Allow-Methods"); got != corsAllowMethods {
		t.Fatalf("disallowed preflight allow methods = %q; want %q", got, corsAllowMethods)
	}

	disallowedRequest := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	disallowedRequest.Header.Set("Origin", "https://web.example.test/")
	disallowedResponse = httptest.NewRecorder()
	router.ServeHTTP(disallowedResponse, disallowedRequest)
	disallowedHeaders := disallowedResponse.Result().Header
	if disallowedHeaders.Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("non-exact origin received Access-Control-Allow-Origin")
	}
	if got := disallowedHeaders.Get("Access-Control-Expose-Headers"); got != corsExposeHeaders {
		t.Fatalf("disallowed origin expose headers = %q; want %q", got, corsExposeHeaders)
	}
	if got := disallowedHeaders.Get("Vary"); got != "Origin" {
		t.Fatalf("disallowed origin Vary = %q; want Origin", got)
	}
}

func TestConfiguredOriginsNormalizeForCORSAndRejectMalformedRequestOrigins(t *testing.T) {
	t.Parallel()

	router := NewErrorRouter(RouterConfig{WebOrigin: "HTTPS://WEB.EXAMPLE.TEST:443/"}, http.StatusNotFound, "not_found")
	request := httptest.NewRequest(http.MethodOptions, "/v1/unknown", nil)
	request.Header.Set("Origin", "https://web.example.test")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent || response.Header().Get("Access-Control-Allow-Origin") != "https://web.example.test" {
		t.Fatalf("normalized configured origin response=%d headers=%v", response.Code, response.Header())
	}

	for _, origin := range []string{"https://web.example.test/", "https://web.example.test/path", "https://web.example.test?query", "https://user@web.example.test"} {
		request := httptest.NewRequest(http.MethodOptions, "/v1/unknown", nil)
		request.Header.Set("Origin", origin)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Errorf("malformed Origin %q received CORS access", origin)
		}
	}
}

func TestOriginNormalizersCanonicalizePortsAndIPv6(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		input      string
		want       string
		wantOK     bool
		configured bool
	}{
		{input: "HTTPS://WEB.EXAMPLE.TEST:443", want: "https://web.example.test", wantOK: true},
		{input: "http://[::1]:80", want: "http://[::1]", wantOK: true},
		{input: "https://web.example.test/", want: "", configured: false},
		{input: "https://web.example.test/", want: "https://web.example.test", wantOK: true, configured: true},
		{input: "https://web.example.test/path", want: "", configured: true},
		{input: "https://web.example.test?", want: "", configured: true},
	} {
		t.Run(test.input, func(t *testing.T) {
			var got string
			var ok bool
			if test.configured {
				got, ok = NormalizeConfiguredOrigin(test.input)
			} else {
				got, ok = NormalizeOrigin(test.input)
			}
			if got != test.want || ok != test.wantOK {
				t.Fatalf("normalize origin %q = %q, %v; want %q, %v", test.input, got, ok, test.want, test.wantOK)
			}
		})
	}
}

func TestRouterRejectsInvalidRouteParametersBeforeDispatch(t *testing.T) {
	t.Parallel()

	router := newTestRouter(t, nil, testOperationHandlers(), "synthetic-proxy-secret")
	path := "/v1/vaults/" + strings.Repeat("a", MaxRouteParameterLength+1) + "/accounts"
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d; want %d: %s", response.Code, http.StatusBadRequest, response.Body.String())
	}
	var body ApiError
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Error != "invalid_request" {
		t.Fatalf("error = %q; want invalid_request", body.Error)
	}
	if got := response.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q; want no-store", got)
	}

	headResponse := httptest.NewRecorder()
	router.ServeHTTP(headResponse, httptest.NewRequest(http.MethodHead, path, nil))
	if headResponse.Code != http.StatusBadRequest {
		t.Fatalf("HEAD invalid path status = %d; want %d", headResponse.Code, http.StatusBadRequest)
	}
	if headResponse.Body.Len() != 0 {
		t.Fatalf("HEAD invalid path body = %q; want empty", headResponse.Body.String())
	}
}

func TestRouterDecodesEscapedPathParametersBeforeValidationAndDispatch(t *testing.T) {
	t.Parallel()

	var vaultID string
	handlers := testOperationHandlers()
	handlers["getVaultsVaultIdAccounts"] = func(ctx *echo.Context) error {
		vaultID = ctx.Param("vaultId")
		return ctx.NoContent(http.StatusNoContent)
	}
	router := newTestRouter(t, nil, handlers, "synthetic-proxy-secret")

	request := httptest.NewRequest(http.MethodGet, "/v1/vaults/vault%2Fsynthetic/accounts", nil)
	request.Header.Set("X-Rhasia-Proxy-Secret", "synthetic-proxy-secret")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("encoded-slash status = %d; want %d: %s", response.Code, http.StatusNoContent, response.Body.String())
	}
	if vaultID != "vault/synthetic" {
		t.Fatalf("decoded vaultId = %q; want vault/synthetic", vaultID)
	}

	whitespaceRequest := httptest.NewRequest(http.MethodGet, "/v1/vaults/vault%20synthetic/accounts", nil)
	whitespaceRequest.Header.Set("X-Rhasia-Proxy-Secret", "synthetic-proxy-secret")
	whitespaceResponse := httptest.NewRecorder()
	router.ServeHTTP(whitespaceResponse, whitespaceRequest)
	if whitespaceResponse.Code != http.StatusBadRequest {
		t.Fatalf("encoded-whitespace status = %d; want %d", whitespaceResponse.Code, http.StatusBadRequest)
	}
	var body ApiError
	if err := json.NewDecoder(whitespaceResponse.Body).Decode(&body); err != nil || body.Error != "invalid_request" {
		t.Fatalf("encoded-whitespace error = %#v, %v; want invalid_request", body, err)
	}

	malformedRequest := httptest.NewRequest(http.MethodGet, "/v1/vaults/synthetic/accounts", nil)
	malformedRequest.URL.Path = "/v1/vaults/%ZZ/accounts"
	malformedRequest.URL.RawPath = malformedRequest.URL.Path
	malformedRequest.Header.Set("X-Rhasia-Proxy-Secret", "synthetic-proxy-secret")
	malformedResponse := httptest.NewRecorder()
	router.ServeHTTP(malformedResponse, malformedRequest)
	if malformedResponse.Code != http.StatusBadRequest {
		t.Fatalf("malformed escaped path status = %d; want %d", malformedResponse.Code, http.StatusBadRequest)
	}
	if err := json.NewDecoder(malformedResponse.Body).Decode(&body); err != nil || body.Error != "invalid_request" {
		t.Fatalf("malformed escaped path error = %#v, %v; want invalid_request", body, err)
	}
}

func TestRouterMapsNotFoundAndInternalErrorsWithoutLeakingDetails(t *testing.T) {
	t.Parallel()

	var info bytes.Buffer
	var warnings bytes.Buffer
	var errorLogs bytes.Buffer
	logger := &JSONEventLogger{Info: &info, Warn: &warnings, Error: &errorLogs}
	handlers := testOperationHandlers()
	handlers["getMe"] = func(*echo.Context) error { return errors.New("synthetic internal detail") }
	router := newTestRouter(t, logger, handlers, "synthetic-proxy-secret")

	notFoundResponse := httptest.NewRecorder()
	router.ServeHTTP(notFoundResponse, httptest.NewRequest(http.MethodGet, "/v1/not-a-route", nil))
	if notFoundResponse.Code != http.StatusNotFound {
		t.Fatalf("not-found status = %d; want %d", notFoundResponse.Code, http.StatusNotFound)
	}
	var notFoundBody ApiError
	if err := json.NewDecoder(notFoundResponse.Body).Decode(&notFoundBody); err != nil {
		t.Fatalf("decode not-found response: %v", err)
	}
	if notFoundBody.Error != "not_found" {
		t.Fatalf("not-found error = %q; want not_found", notFoundBody.Error)
	}

	failureResponse := httptest.NewRecorder()
	router.ServeHTTP(failureResponse, httptest.NewRequest(http.MethodGet, "/v1/me", nil))
	if failureResponse.Code != http.StatusInternalServerError {
		t.Fatalf("internal-error status = %d; want %d", failureResponse.Code, http.StatusInternalServerError)
	}
	var failureBody ApiError
	if err := json.NewDecoder(failureResponse.Body).Decode(&failureBody); err != nil {
		t.Fatalf("decode internal-error response: %v", err)
	}
	if failureBody.Error != "internal_error" {
		t.Fatalf("internal error = %q; want internal_error", failureBody.Error)
	}
	if strings.Contains(errorLogs.String(), "synthetic internal detail") {
		t.Fatalf("internal error details leaked to logs: %s", errorLogs.String())
	}
	if got := failureResponse.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q; want no-store", got)
	}
}

func TestRouterPreservesExplicitCacheControlAfterSettingDefault(t *testing.T) {
	t.Parallel()

	handlers := testOperationHandlers()
	handlers["getMe"] = func(ctx *echo.Context) error {
		ctx.Response().Header().Set("Cache-Control", "private, max-age=60")
		return ctx.NoContent(http.StatusNoContent)
	}
	router := newTestRouter(t, nil, handlers, "synthetic-proxy-secret")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/me", nil))

	if got := response.Result().Header.Get("Cache-Control"); got != "private, max-age=60" {
		t.Fatalf("Cache-Control = %q; want handler override", got)
	}
}

func TestRouterSupportsHeadOnGetRoutes(t *testing.T) {
	t.Parallel()

	router := newTestRouter(t, nil, testOperationHandlers(), "synthetic-proxy-secret")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodHead, "/v1/health", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("HEAD /v1/health status = %d; want %d", response.Code, http.StatusOK)
	}
	if response.Body.Len() != 0 {
		t.Fatalf("HEAD response body = %q; want empty", response.Body.String())
	}
}
