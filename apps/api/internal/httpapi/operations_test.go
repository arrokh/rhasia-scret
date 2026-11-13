package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"
)

func testOperationHandlers() map[string]OperationHandler {
	handlers := make(map[string]OperationHandler)
	for _, operationID := range ExpectedOperationIDs() {
		id := operationID
		handlers[id] = func(ctx *echo.Context) error {
			return ctx.JSON(http.StatusOK, map[string]string{"operationId": id})
		}
	}
	return handlers
}

func TestNewServerRequiresExactOpenAPIOperationCoverage(t *testing.T) {
	t.Parallel()

	operationIDs := ExpectedOperationIDs()
	if len(operationIDs) != 70 {
		t.Fatalf("OpenAPI contract has %d operation handlers; want 70", len(operationIDs))
	}

	missing := testOperationHandlers()
	delete(missing, operationIDs[0])
	if _, err := NewServer(missing); err == nil || !strings.Contains(err.Error(), operationIDs[0]) {
		t.Fatalf("NewServer() error = %v; want missing operation %q", err, operationIDs[0])
	}

	extra := testOperationHandlers()
	extra["notInOpenAPI"] = func(*echo.Context) error { return nil }
	if _, err := NewServer(extra); err == nil || !strings.Contains(err.Error(), "notInOpenAPI") {
		t.Fatalf("NewServer() error = %v; want unexpected operation to be rejected", err)
	}

	nilHandler := testOperationHandlers()
	nilHandler[operationIDs[0]] = nil
	if _, err := NewServer(nilHandler); err == nil || !strings.Contains(err.Error(), operationIDs[0]) {
		t.Fatalf("NewServer() error = %v; want nil operation handler to be rejected", err)
	}
}

func TestGeneratedOperationRoutesDispatchEveryOpenAPIOperation(t *testing.T) {
	t.Parallel()

	routes := ExpectedOperationRoutes()
	if len(routes) != 70 {
		t.Fatalf("generated route count = %d; want 70", len(routes))
	}
	server, err := NewServer(testOperationHandlers())
	if err != nil {
		t.Fatalf("NewServer(): %v", err)
	}
	router := echo.New()
	RegisterOperationHandlersWithBaseURL(router, server, "/v1")

	seen := make(map[string]struct{}, len(routes))
	for _, route := range routes {
		if _, exists := seen[route.OperationID]; exists {
			t.Fatalf("duplicate generated operation ID %q", route.OperationID)
		}
		seen[route.OperationID] = struct{}{}

		t.Run(route.Method+" "+route.Path, func(t *testing.T) {
			segments := strings.Split(route.Path, "/")
			for index, segment := range segments {
				if strings.HasPrefix(segment, ":") {
					segments[index] = "synthetic-" + strings.TrimPrefix(segment, ":")
				}
			}
			request := httptest.NewRequest(route.Method, "/v1"+strings.Join(segments, "/"), nil)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d; want %d: %s", response.Code, http.StatusOK, response.Body.String())
			}
			var body struct {
				OperationID string `json:"operationId"`
			}
			if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if body.OperationID != route.OperationID {
				t.Fatalf("dispatched operation = %q; want %q", body.OperationID, route.OperationID)
			}
		})
	}
}

func TestGeneratedOperationRoutesLeaveQueryValidationToHandlers(t *testing.T) {
	t.Parallel()

	handlers := testOperationHandlers()
	handlers["getSecuresharelinks"] = func(ctx *echo.Context) error {
		if ctx.Request().Header.Get("X-Test-User") == "" {
			return ctx.JSON(http.StatusUnauthorized, ApiError{Error: "authentication_required"})
		}
		if ctx.QueryParam("verifier") == "" {
			return ctx.JSON(http.StatusBadRequest, ApiError{Error: "invalid_share_link"})
		}
		return ctx.NoContent(http.StatusNoContent)
	}
	handlers["getVaultsVaultIdAuditevents"] = func(ctx *echo.Context) error {
		if ctx.QueryParam("limit") == "not-an-integer" {
			return ctx.JSON(http.StatusBadRequest, ApiError{Error: "invalid_pagination"})
		}
		return ctx.NoContent(http.StatusNoContent)
	}
	server, err := NewServer(handlers)
	if err != nil {
		t.Fatalf("NewServer(): %v", err)
	}

	router := echo.New()
	RegisterOperationHandlersWithBaseURL(router, server, "/v1")

	unauthenticated := httptest.NewRecorder()
	router.ServeHTTP(unauthenticated, httptest.NewRequest(http.MethodGet, "/v1/secure-share-links", nil))
	if unauthenticated.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated missing-verifier status = %d; want auth to precede query validation", unauthenticated.Code)
	}
	var body ApiError
	if err := json.NewDecoder(unauthenticated.Body).Decode(&body); err != nil || body.Error != "authentication_required" {
		t.Fatalf("unauthenticated error = %#v, %v; want authentication_required", body, err)
	}

	authenticated := httptest.NewRequest(http.MethodGet, "/v1/secure-share-links", nil)
	authenticated.Header.Set("X-Test-User", "synthetic-user")
	invalidVerifier := httptest.NewRecorder()
	router.ServeHTTP(invalidVerifier, authenticated)
	if invalidVerifier.Code != http.StatusBadRequest {
		t.Fatalf("authenticated missing-verifier status = %d; want %d", invalidVerifier.Code, http.StatusBadRequest)
	}
	if err := json.NewDecoder(invalidVerifier.Body).Decode(&body); err != nil || body.Error != "invalid_share_link" {
		t.Fatalf("authenticated missing-verifier error = %#v, %v; want invalid_share_link", body, err)
	}

	invalidLimit := httptest.NewRecorder()
	router.ServeHTTP(invalidLimit, httptest.NewRequest(http.MethodGet, "/v1/vaults/vault-synthetic/audit-events?limit=not-an-integer", nil))
	if invalidLimit.Code != http.StatusBadRequest {
		t.Fatalf("invalid-limit status = %d; want %d", invalidLimit.Code, http.StatusBadRequest)
	}
	if err := json.NewDecoder(invalidLimit.Body).Decode(&body); err != nil || body.Error != "invalid_pagination" {
		t.Fatalf("invalid-limit error = %#v, %v; want invalid_pagination", body, err)
	}
}

func TestGeneratedEchoRouteDispatchesToItsOpenAPIOperationHandler(t *testing.T) {
	t.Parallel()

	handlers := testOperationHandlers()
	server, err := NewServer(handlers)
	if err != nil {
		t.Fatalf("NewServer(): %v", err)
	}
	handlers["getHealth"] = nil

	router := echo.New()
	RegisterHandlersWithBaseURL(router, server, "/v1")
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("GET /v1/health status = %d; want %d: %s", response.Code, http.StatusOK, response.Body.String())
	}
	var body struct {
		OperationID string `json:"operationId"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.OperationID != "getHealth" {
		t.Fatalf("dispatched operation = %q; want getHealth", body.OperationID)
	}
}
