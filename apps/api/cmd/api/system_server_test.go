package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/config"
)

func TestSystemHandlerServesDatabaseIndependentProbes(t *testing.T) {
	handler := newSystemHandler(config.Environment{Port: 8787}, nil)

	for _, path := range []string{"/v1/health", "/v1/time"} {
		t.Run(path, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, path, nil)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusOK {
				t.Fatalf("GET %s status = %d, want %d", path, response.Code, http.StatusOK)
			}
			var body map[string]string
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode GET %s response: %v", path, err)
			}
			if path == "/v1/health" && body["status"] != "ok" {
				t.Fatalf("GET %s body = %v, want status ok", path, body)
			}
			if path == "/v1/time" && body["now"] == "" {
				t.Fatalf("GET %s body = %v, want a timestamp", path, body)
			}
		})
	}
}
