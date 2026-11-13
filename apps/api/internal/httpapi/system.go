package httpapi

import (
	"net/http"
	"time"

	"github.com/labstack/echo/v5"
)

func SystemHandlers(clock func() time.Time) map[string]OperationHandler {
	if clock == nil {
		clock = time.Now
	}
	return map[string]OperationHandler{
		"getHealth": func(ctx *echo.Context) error {
			return ctx.JSON(http.StatusOK, HealthResponse{Status: HealthResponseStatus("ok")})
		},
		"getTime": func(ctx *echo.Context) error {
			now := clock().UTC().Truncate(time.Millisecond).Format("2006-01-02T15:04:05.000Z")
			return ctx.JSON(http.StatusOK, TimeResponse{Now: now})
		},
	}
}
