package handler

import (
	"net/http"

	"github.com/nooroctavian/rhasia-scret/apps/api/vercelruntime"
)

var apiHandler = vercelruntime.NewAPIHandler()

func Handler(writer http.ResponseWriter, request *http.Request) {
	apiHandler.ServeHTTP(writer, request)
}
