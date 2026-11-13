package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/buildinfo"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/config"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	servercomposition "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/server-composition"
)

const shutdownTimeout = 10 * time.Second

func main() {
	if err := run(); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	arguments := os.Args[1:]
	if len(arguments) == 0 {
		return runServer()
	}
	if len(arguments) != 1 {
		return errors.New("unsupported API command")
	}
	switch arguments[0] {
	case "serve":
		return runServer()
	case "serve-system":
		return runSystemServer()
	case "retention-purge":
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		return runRetentionScheduler(ctx)
	case "healthcheck":
		environment, err := config.FromProcess()
		if err != nil {
			return errors.New("API healthcheck configuration is invalid")
		}
		return runHealthcheck(environment.Port)
	case "smtp-preflight":
		return runSMTPPreflight()
	case "verify-config":
		if err := verifyDeploymentConfiguration(os.LookupEnv); err != nil {
			return err
		}
		_, err := fmt.Fprintln(os.Stdout, "API deployment configuration verified.")
		return err
	case "version":
		return writeVersion(os.Stdout)
	default:
		return errors.New("unsupported API command")
	}
}

func writeVersion(output io.Writer) error {
	_, err := fmt.Fprintf(output, "rhasia-scret-api %s %s\n", buildinfo.Version, buildinfo.CommitSHA())
	return err
}

func runServer() error {
	logger := httpapi.NewJSONEventLogger()
	environment, err := config.FromProcess()
	if err != nil {
		logger.Log("error", "api_startup_configuration_invalid", map[string]any{"requestId": "startup"})
		return errors.New("API startup configuration is invalid")
	}
	runtime, err := servercomposition.OpenRuntime(environment, logger)
	if err != nil {
		logger.Log("error", "api_startup_failed", map[string]any{"requestId": "startup"})
		return errors.New("API startup failed")
	}
	defer runtime.Close()
	return serveHTTPServer(environment.Port, runtime.Router, logger)
}

func runSystemServer() error {
	logger := httpapi.NewJSONEventLogger()
	environment, err := config.FromProcess()
	if err != nil {
		logger.Log("error", "api_startup_configuration_invalid", map[string]any{"requestId": "startup"})
		return errors.New("API startup configuration is invalid")
	}
	return serveHTTPServer(environment.Port, newSystemHandler(environment, logger), logger)
}

func newSystemHandler(environment config.Environment, logger httpapi.APIEventLogger) http.Handler {
	return httpapi.NewSystemRouter(httpapi.RouterConfig{
		WebOrigin:   environment.WebOrigin,
		ProxySecret: environment.ProxySecret,
		Logger:      logger,
	}, time.Now)
}

func serveHTTPServer(port int, handler http.Handler, logger httpapi.APIEventLogger) error {
	server := &http.Server{
		Addr:              ":" + strconv.Itoa(port),
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	shutdownContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	serverErrors := make(chan error, 1)
	go func() {
		serverErrors <- server.ListenAndServe()
	}()

	select {
	case <-shutdownContext.Done():
		ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			logger.Log("error", "api_shutdown_failed", map[string]any{"requestId": "shutdown"})
			_ = server.Close()
		}
		return nil
	case err := <-serverErrors:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		logger.Log("error", "api_listener_failed", map[string]any{"requestId": "startup"})
		return errors.New("API listener failed")
	}
}
