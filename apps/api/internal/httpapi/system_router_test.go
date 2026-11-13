package httpapi

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestNewSystemRouterServesDatabaseIndependentEndpoints(t *testing.T) {
	clock := func() time.Time { return time.Date(2026, time.January, 2, 3, 4, 5, 678_000_000, time.UTC) }
	router := NewSystemRouter(RouterConfig{
		WebOrigin: "https://web.example.test",
		Logger:    &JSONEventLogger{Info: io.Discard, Warn: io.Discard, Error: io.Discard},
	}, clock)

	tests := []struct {
		name       string
		method     string
		path       string
		wantStatus int
		wantBody   string
	}{
		{name: "health", method: http.MethodGet, path: "/v1/health", wantStatus: http.StatusOK, wantBody: `{"status":"ok"}`},
		{name: "time", method: http.MethodGet, path: "/v1/time", wantStatus: http.StatusOK, wantBody: `{"now":"2026-01-02T03:04:05.678Z"}`},
		{name: "health head", method: http.MethodHead, path: "/v1/health", wantStatus: http.StatusOK},
		{name: "time head", method: http.MethodHead, path: "/v1/time", wantStatus: http.StatusOK},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(test.method, test.path, nil)
			request.Header.Set("X-Request-Id", "0123456789abcdef")
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, test.wantStatus)
			}
			if got := strings.TrimSpace(response.Body.String()); got != test.wantBody {
				t.Fatalf("body = %q, want %q", got, test.wantBody)
			}
			responseHeaders := response.Result().Header
			if got := responseHeaders.Get("Cache-Control"); got != "no-store" {
				t.Fatalf("Cache-Control = %q, want no-store", got)
			}
			if got := responseHeaders.Get("X-Request-Id"); got != "0123456789abcdef" {
				t.Fatalf("X-Request-Id = %q", got)
			}
			if got := responseHeaders.Get("Vary"); got != "Origin" {
				t.Fatalf("Vary = %q, want Origin", got)
			}
		})
	}
}

func TestNewSystemRouterRejectsUnknownOperations(t *testing.T) {
	router := NewSystemRouter(RouterConfig{}, time.Now)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/not-a-route", nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", response.Code)
	}
	if strings.TrimSpace(response.Body.String()) != `{"error":"not_found"}` {
		t.Fatalf("body = %q", response.Body.String())
	}
}
