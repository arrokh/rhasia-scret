package handler

import (
	"net/http"
	"runtime"
	"runtime/debug"

	"github.com/labstack/echo/v5"
)

type runtimeInfo struct {
	Go   string `json:"go"`
	Echo string `json:"echo"`
}

var app = newApp()

// Handler is the Vercel Go function entrypoint for this temporary preview probe.
func Handler(w http.ResponseWriter, r *http.Request) {
	app.ServeHTTP(w, r)
}

func newApp() *echo.Echo {
	e := echo.New()
	e.Any("/*", func(c *echo.Context) error {
		info := runtimeInfo{Go: runtime.Version(), Echo: echoVersion()}
		return c.JSON(http.StatusOK, info)
	})
	e.Any("/", func(c *echo.Context) error {
		info := runtimeInfo{Go: runtime.Version(), Echo: echoVersion()}
		return c.JSON(http.StatusOK, info)
	})
	return e
}

func echoVersion() string {
	buildInfo, ok := debug.ReadBuildInfo()
	if !ok {
		return "unavailable"
	}
	for _, dependency := range buildInfo.Deps {
		if dependency.Path == "github.com/labstack/echo/v5" {
			return dependency.Version
		}
	}
	return "unavailable"
}
