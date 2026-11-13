package vercelruntime

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestVercelHandlersServeSystemRoutesWithoutDatabase(t *testing.T) {
	tests := []struct {
		name    string
		handler http.Handler
		path    string
		field   string
	}{
		{name: "API health", handler: NewAPIHandler(), path: "/api/health", field: "status"},
		{name: "health function", handler: NewHealthHandler(), path: "/api/health", field: "status"},
		{name: "time function", handler: NewTimeHandler(), path: "/api/time", field: "now"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, test.path, nil)
			test.handler.ServeHTTP(response, request)

			if response.Code != http.StatusOK {
				t.Fatalf("status = %d; want %d", response.Code, http.StatusOK)
			}
			var body map[string]json.RawMessage
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if _, ok := body[test.field]; !ok {
				t.Fatalf("response does not contain %q: %s", test.field, response.Body.String())
			}
		})
	}
}
