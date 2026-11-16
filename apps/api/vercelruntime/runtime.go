// Package vercelruntime exposes public handler constructors for Vercel's Go
// function builder, which relocates handlers into a generated module outside
// this application's internal-package boundary.
package vercelruntime

import (
	"net/http"
	"os"

	servercomposition "github.com/nooroctavian/rhasia-scret/apps/api/internal/app/api"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
)

// NewAPIHandler creates the database-backed API handler with database-independent
// health and time routes.
func NewAPIHandler() http.Handler {
	return newHandler("")
}

// NewHealthHandler creates the Vercel health-function handler.
func NewHealthHandler() http.Handler {
	return newHandler("/v1/health")
}

// NewTimeHandler creates the Vercel time-function handler.
func NewTimeHandler() http.Handler {
	return newHandler("/v1/time")
}

func newHandler(path string) http.Handler {
	handler := servercomposition.NewVercelHandler(os.LookupEnv, httpapi.NewJSONEventLogger())
	if path == "" {
		return handler
	}
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		clone := request.Clone(request.Context())
		urlCopy := *request.URL
		urlCopy.Path = path
		urlCopy.RawPath = ""
		clone.URL = &urlCopy
		handler.ServeHTTP(writer, clone)
	})
}
