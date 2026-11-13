package handler

import (
	"net/http"

	"github.com/nooroctavian/rhasia-scret/apps/api/vercelruntime"
)

var timeHandler = vercelruntime.NewTimeHandler()

func Handler(writer http.ResponseWriter, request *http.Request) {
	timeHandler.ServeHTTP(writer, request)
}
