package servercomposition

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/config"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

type operationBoundaryFixture struct {
	Note    string `json:"note"`
	Request struct {
		Origin      string `json:"origin"`
		RequestID   string `json:"requestId"`
		ContentType string `json:"contentType"`
		NonGetBody  string `json:"nonGetBody"`
		FixedTime   string `json:"fixedTime"`
	} `json:"request"`
	Routes []operationBoundaryResponse `json:"routes"`
}

type operationBoundaryResponse struct {
	Method  string            `json:"method"`
	Path    string            `json:"path"`
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
	Body    json.RawMessage   `json:"body"`
}

func TestGoRuntimeMatchesFrozenAnonymousBoundaryForEveryOperation(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	fixture := readOperationBoundaryFixture(t)
	if len(fixture.Routes) != 70 {
		t.Fatalf("frozen anonymous-boundary fixture has %d routes; want 70", len(fixture.Routes))
	}

	fixedTime, err := time.Parse(time.RFC3339Nano, fixture.Request.FixedTime)
	if err != nil {
		t.Fatalf("parse fixture clock: %v", err)
	}
	router, err := NewRouter(pool, config.Environment{
		NodeEnvironment: "test",
		WebOrigin:       fixture.Request.Origin,
		ProxySecret:     "proxy-secret-that-is-long-enough-for-tests-123456",
		AuthBackend:     "none",
	}, routeBoundaryTestLogger{}, func() time.Time { return fixedTime })
	if err != nil {
		t.Fatalf("compose Go API runtime: %v", err)
	}

	expectedByRoute := make(map[string]operationBoundaryResponse, len(fixture.Routes))
	for _, response := range fixture.Routes {
		key := operationBoundaryKey(response.Method, response.Path)
		if _, exists := expectedByRoute[key]; exists {
			t.Fatalf("duplicate frozen anonymous-boundary fixture route %q", key)
		}
		expectedByRoute[key] = response
	}

	used := make(map[string]struct{}, len(fixture.Routes))
	operationRoutes := httpapi.ExpectedOperationRoutes()
	if len(operationRoutes) != 70 {
		t.Fatalf("Go OpenAPI transport has %d routes; want 70", len(operationRoutes))
	}
	for _, operation := range operationRoutes {
		path := materializeBoundaryRoute(operation.Path)
		key := operationBoundaryKey(operation.Method, path)
		expected, exists := expectedByRoute[key]
		if !exists {
			t.Fatalf("no frozen anonymous-boundary fixture for OpenAPI operation %s (%s)", operation.OperationID, key)
		}
		used[key] = struct{}{}

		t.Run(operation.OperationID, func(t *testing.T) {
			var request *http.Request
			if operation.Method == http.MethodGet {
				request = httptest.NewRequest(operation.Method, "https://api.example.test"+path, nil)
			} else {
				request = httptest.NewRequest(operation.Method, "https://api.example.test"+path, strings.NewReader(fixture.Request.NonGetBody))
			}
			request.Header.Set("Origin", fixture.Request.Origin)
			request.Header.Set("Content-Type", fixture.Request.ContentType)
			request.Header.Set("X-Request-ID", fixture.Request.RequestID)

			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != expected.Status {
				t.Fatalf("status=%d; frozen baseline status=%d: %s", response.Code, expected.Status, response.Body.String())
			}
			for name, value := range expected.Headers {
				if actual := response.Header().Get(name); actual != value {
					t.Errorf("header %s=%q; frozen baseline=%q", name, actual, value)
				}
			}

			if expected.Status == http.StatusNoContent {
				var expectedBody string
				if err := json.Unmarshal(expected.Body, &expectedBody); err != nil || expectedBody != "" {
					t.Fatalf("decode expected empty body %s: %v", expected.Body, err)
				}
				if response.Body.Len() != 0 {
					t.Fatalf("body=%q; frozen baseline body is empty", response.Body.String())
				}
				return
			}

			var expectedBody any
			if err := json.Unmarshal(expected.Body, &expectedBody); err != nil {
				t.Fatalf("decode frozen baseline body: %v", err)
			}
			var actualBody any
			if err := json.NewDecoder(bytes.NewReader(response.Body.Bytes())).Decode(&actualBody); err != nil {
				t.Fatalf("decode Go response body: %v", err)
			}
			if !reflect.DeepEqual(actualBody, expectedBody) {
				t.Fatalf("body=%#v; frozen baseline body=%#v", actualBody, expectedBody)
			}
		})
	}
	if len(used) != len(fixture.Routes) {
		t.Fatalf("matched %d of %d frozen anonymous-boundary routes", len(used), len(fixture.Routes))
	}
}

func readOperationBoundaryFixture(t *testing.T) operationBoundaryFixture {
	t.Helper()
	_, sourcePath, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("locate Go operation boundary test source")
	}
	fixturePath := filepath.Join(filepath.Dir(sourcePath), "../../../../../packages/api-contract/test-fixtures/operation-boundaries.json")
	fixtureBytes, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read frozen anonymous-boundary fixture: %v", err)
	}
	var fixture operationBoundaryFixture
	if err := json.Unmarshal(fixtureBytes, &fixture); err != nil {
		t.Fatalf("decode frozen API-boundary compatibility fixture: %v", err)
	}
	return fixture
}

func materializeBoundaryRoute(path string) string {
	return "/v1" + strings.NewReplacer(
		":vaultId", "vault_1",
		":userId", "user_1",
		":invitationId", "invitation_1",
	).Replace(path)
}

func operationBoundaryKey(method, path string) string {
	return method + " " + path
}

type routeBoundaryTestLogger struct{}

func (routeBoundaryTestLogger) Log(string, string, map[string]any) {}
