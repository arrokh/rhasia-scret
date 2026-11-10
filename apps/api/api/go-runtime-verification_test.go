package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestVercelRuntimeProbeReportsPinnedVersions(t *testing.T) {
	for _, path := range []string{"/api/go-runtime-verification", "/go-runtime-verification", "/"} {
		t.Run(path, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, path, nil)
			response := httptest.NewRecorder()

			Handler(response, request)

			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
			}
			var actual runtimeInfo
			if err := json.Unmarshal(response.Body.Bytes(), &actual); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if actual.Go != "go1.27.3" {
				t.Fatalf("Go version = %q, want go1.27.3", actual.Go)
			}
			if actual.Echo != "v5.4.4" {
				t.Fatalf("Echo version = %q, want v5.4.4", actual.Echo)
			}
		})
	}
}
