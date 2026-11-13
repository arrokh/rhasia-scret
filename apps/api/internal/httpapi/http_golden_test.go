package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/labstack/echo/v5"
)

type httpGoldenExample struct {
	Method             string            `json:"method"`
	Path               string            `json:"path"`
	Status             int               `json:"status"`
	Headers            map[string]string `json:"headers"`
	Body               json.RawMessage   `json:"body"`
	MustNotEchoHeaders []string          `json:"mustNotEchoHeaders"`
}

type httpGoldenFixture struct {
	Health        httpGoldenExample `json:"health"`
	Time          httpGoldenExample `json:"time"`
	SessionRevoke httpGoldenExample `json:"sessionRevoke"`
	InvalidProxy  httpGoldenExample `json:"invalidProxy"`
	HeadHealth    httpGoldenExample `json:"headHealth"`
}

func TestAPIHTTPBehaviorMatchesSharedSyntheticGoldenFixtures(t *testing.T) {
	fixtureBytes, err := os.ReadFile("../../../../packages/api-contract/test-fixtures/http-golden.json")
	if err != nil {
		t.Fatalf("read shared HTTP golden fixture: %v", err)
	}
	var fixture httpGoldenFixture
	if err := json.Unmarshal(fixtureBytes, &fixture); err != nil {
		t.Fatalf("decode shared HTTP golden fixture: %v", err)
	}

	handlers := testOperationHandlers()
	for operationID, handler := range SystemHandlers(func() time.Time {
		return time.Date(2026, time.November, 10, 0, 0, 0, 0, time.UTC)
	}) {
		handlers[operationID] = handler
	}
	handlers["postAuthSessionRevoke"] = func(ctx *echo.Context) error {
		return ctx.NoContent(http.StatusNoContent)
	}
	router := newTestRouter(t, nil, handlers, "synthetic-proxy-secret-0123456789")

	for _, test := range []struct {
		name         string
		example      httpGoldenExample
		extraHeaders map[string]string
	}{
		{name: "health", example: fixture.Health},
		{name: "time", example: fixture.Time},
		{name: "session revoke", example: fixture.SessionRevoke},
		{name: "invalid proxy", example: fixture.InvalidProxy, extraHeaders: map[string]string{"X-Rhasia-Proxy-Secret": "synthetic-invalid-marker"}},
		{name: "HEAD health", example: fixture.HeadHealth},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(test.example.Method, "/v1"+test.example.Path, nil)
			for name, value := range test.example.Headers {
				request.Header.Set(name, value)
			}
			for name, value := range test.extraHeaders {
				request.Header.Set(name, value)
			}
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != test.example.Status {
				t.Fatalf("response status=%d; want %d: %s", response.Code, test.example.Status, response.Body.String())
			}
			for name, value := range test.example.Headers {
				if got := response.Header().Get(name); got != value {
					t.Errorf("response header %s=%q; want %q", name, got, value)
				}
			}

			if test.example.Method == http.MethodHead || test.example.Status == http.StatusNoContent {
				if response.Body.Len() != 0 {
					t.Fatalf("response body=%q; want empty", response.Body.String())
				}
				var expectedBody string
				if err := json.Unmarshal(test.example.Body, &expectedBody); err != nil || expectedBody != "" {
					t.Fatalf("golden empty-body example=%s, %v", test.example.Body, err)
				}
			} else {
				var expectedBody any
				if err := json.Unmarshal(test.example.Body, &expectedBody); err != nil {
					t.Fatalf("decode golden response body: %v", err)
				}
				var actualBody any
				if err := json.Unmarshal(response.Body.Bytes(), &actualBody); err != nil {
					t.Fatalf("decode actual response body: %v", err)
				}
				if !reflect.DeepEqual(actualBody, expectedBody) {
					t.Fatalf("response body=%#v; want %#v", actualBody, expectedBody)
				}
			}

			for _, name := range test.example.MustNotEchoHeaders {
				if got := response.Header().Get(name); got != "" {
					t.Errorf("response unexpectedly echoed %s: %q", name, got)
				}
			}
		})
	}
}
