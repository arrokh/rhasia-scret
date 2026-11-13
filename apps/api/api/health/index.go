package handler

import (
	"net/http"

	"github.com/nooroctavian/rhasia-scret/apps/api/vercelruntime"
)

var healthHandler = vercelruntime.NewHealthHandler()

func Handler(writer http.ResponseWriter, request *http.Request) {
	healthHandler.ServeHTTP(writer, request)
}
