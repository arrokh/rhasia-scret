package http

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	retentionapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/retention"
)

type retentionPurgerStub struct {
	report retentionapp.PurgeReport
	err    error
	calls  int
	now    time.Time
}

func (purger *retentionPurgerStub) Purge(_ context.Context, now time.Time) (retentionapp.PurgeReport, error) {
	purger.calls++
	purger.now = now
	return purger.report, purger.err
}

type retentionLoggerStub struct {
	entries []map[string]any
	levels  []string
	events  []string
}

func (logger *retentionLoggerStub) Log(level string, event string, fields map[string]any) {
	copied := make(map[string]any, len(fields))
	for key, value := range fields {
		copied[key] = value
	}
	logger.entries = append(logger.entries, copied)
	logger.levels = append(logger.levels, level)
	logger.events = append(logger.events, event)
}

func TestRetentionPurgeRequiresLongBearerSecretBeforePurge(t *testing.T) {
	purger := &retentionPurgerStub{}
	secret := strings.Repeat("x", 32)
	handler := NewHandlers(secret, purger, nil, nil, func() (string, error) { return "synthetic-job-id", nil }).OperationHandlers()["getInternalRetentionpurge"]
	for _, authorization := range []string{"", "Bearer wrong", "bearer " + secret, "Bearer " + secret + " extra"} {
		response := invokeRetentionHandler(t, handler, nil, authorization)
		if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "unauthorized") {
			t.Errorf("authorization %q response=%d %s", authorization, response.Code, response.Body.String())
		}
	}
	if purger.calls != 0 {
		t.Fatalf("unauthorized requests invoked purge %d times", purger.calls)
	}
	unconfigured := NewHandlers("short", purger, nil, nil, nil).OperationHandlers()["getInternalRetentionpurge"]
	response := invokeRetentionHandler(t, unconfigured, nil, "Bearer "+secret)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "retention_purge_not_configured") || purger.calls != 0 {
		t.Fatalf("unconfigured retention response=%d calls=%d %s", response.Code, purger.calls, response.Body.String())
	}
}

func TestRetentionPurgeRejectsHeadWithoutRunningCleanup(t *testing.T) {
	purger := &retentionPurgerStub{}
	secret := strings.Repeat("x", 32)
	handler := NewHandlers(secret, purger, nil, nil, nil).OperationHandlers()["getInternalRetentionpurge"]
	request := httptest.NewRequest(http.MethodHead, "/v1/internal/retention-purge", nil)
	request.Header.Set(echo.HeaderAuthorization, "Bearer "+secret)
	response := httptest.NewRecorder()
	ctx := echo.New().NewContext(request, response)
	if err := handler(ctx); err != nil {
		t.Fatalf("HEAD retention handler returned error: %v", err)
	}
	if response.Code != http.StatusMethodNotAllowed || response.Header().Get("Cache-Control") != "no-store" || purger.calls != 0 {
		t.Fatalf("HEAD retention response=%d headers=%v purgeCalls=%d", response.Code, response.Header(), purger.calls)
	}
}

func TestRetentionPurgeRouterRejectsHeadBeforePurging(t *testing.T) {
	purger := &retentionPurgerStub{}
	secret := strings.Repeat("x", 32)
	retentionHandlers := NewHandlers(secret, purger, nil, nil, nil).OperationHandlers()
	handlers := make(map[string]httpapi.OperationHandler, len(httpapi.ExpectedOperationIDs()))
	for _, operationID := range httpapi.ExpectedOperationIDs() {
		handlers[operationID] = func(ctx *echo.Context) error { return ctx.NoContent(http.StatusNoContent) }
	}
	handlers["getInternalRetentionpurge"] = retentionHandlers["getInternalRetentionpurge"]
	router, err := httpapi.NewRouter(httpapi.RouterConfig{}, handlers)
	if err != nil {
		t.Fatalf("NewRouter(): %v", err)
	}
	request := httptest.NewRequest(http.MethodHead, "/v1/internal/retention-purge", nil)
	request.Header.Set(echo.HeaderAuthorization, "Bearer "+secret)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusMethodNotAllowed || response.Header().Get("Cache-Control") != "no-store" || purger.calls != 0 {
		t.Fatalf("routed HEAD response=%d headers=%v purgeCalls=%d", response.Code, response.Header(), purger.calls)
	}
}

func TestRetentionPurgeReturnsBoundedCountsAndNeverLogsPurgedIDs(t *testing.T) {
	now := time.Date(2026, time.August, 1, 2, 3, 4, 0, time.UTC)
	purger := &retentionPurgerStub{report: retentionapp.PurgeReport{
		AccountIDs: []string{"synthetic-account-id"}, VaultIDs: []string{"synthetic-vault-id"},
		AuditEventIDs: []string{"synthetic-audit-id"}, AuthRecordsPurged: 8,
		AccountBacklogRemaining: true, VaultBacklogRemaining: false, AuditBacklogRemaining: true, AuthBacklogRemaining: false,
	}}
	logger := &retentionLoggerStub{}
	secret := strings.Repeat("x", 32)
	handler := NewHandlers(secret, purger, logger, func() time.Time { return now }, func() (string, error) { return "synthetic-job-id", nil }).OperationHandlers()["getInternalRetentionpurge"]
	response := invokeRetentionHandler(t, handler, nil, "Bearer "+secret)
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" || purger.calls != 1 || !purger.now.Equal(now) {
		t.Fatalf("retention response=%d headers=%v calls=%d now=%s body=%s", response.Code, response.Header(), purger.calls, purger.now, response.Body.String())
	}
	want := `{"jobId":"synthetic-job-id","accountCount":1,"vaultCount":1,"auditEventCount":1,"authRecordsPurged":8,"accountBacklogRemaining":true,"vaultBacklogRemaining":false,"auditBacklogRemaining":true,"authBacklogRemaining":false}`
	if strings.TrimSpace(response.Body.String()) != want {
		t.Fatalf("retention response body=%s; want %s", response.Body.String(), want)
	}
	if len(logger.entries) != 1 || logger.levels[0] != "info" || logger.events[0] != "retention_purge_completed" {
		t.Fatalf("retention log=%#v", logger)
	}
	logged := logger.entries[0]
	for _, field := range []string{"synthetic-account-id", "synthetic-vault-id", "synthetic-audit-id", "encryptedPayload", "secret"} {
		if strings.Contains(response.Body.String()+stringifyRetentionLog(logged), field) {
			t.Errorf("retention output leaked forbidden value %q", field)
		}
	}
}

func TestRetentionPurgeRedactsFailuresAndRejectsDuplicateAuthorizationHeaders(t *testing.T) {
	secret := strings.Repeat("x", 32)
	logger := &retentionLoggerStub{}
	purger := &retentionPurgerStub{err: errors.New("synthetic-ciphertext-must-not-be-logged")}
	handler := NewHandlers(secret, purger, logger, nil, func() (string, error) { return "synthetic-job-id", nil }).OperationHandlers()["getInternalRetentionpurge"]
	response := invokeRetentionHandler(t, handler, []string{"Bearer " + secret, "Bearer invalid"}, "")
	if response.Code != http.StatusUnauthorized || purger.calls != 0 {
		t.Fatalf("duplicate authorization response=%d calls=%d", response.Code, purger.calls)
	}
	response = invokeRetentionHandler(t, handler, nil, "Bearer "+secret)
	if response.Code != http.StatusInternalServerError || !strings.Contains(response.Body.String(), `"error":"retention_purge_failed"`) ||
		!strings.Contains(response.Body.String(), `"jobId":"synthetic-job-id"`) || strings.Contains(response.Body.String(), "synthetic-ciphertext") {
		t.Fatalf("retention failure response=%d %s", response.Code, response.Body.String())
	}
	if len(logger.entries) != 1 || logger.levels[0] != "error" || logger.events[0] != "retention_purge_failed" ||
		strings.Contains(stringifyRetentionLog(logger.entries[0]), "synthetic-ciphertext") {
		t.Fatalf("retention error log=%#v", logger)
	}
}

func invokeRetentionHandler(t *testing.T, handler httpapi.OperationHandler, authorizationHeaders []string, authorization string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/v1/internal/retention-purge", nil)
	for _, value := range authorizationHeaders {
		request.Header.Add(echo.HeaderAuthorization, value)
	}
	if authorization != "" {
		request.Header.Set(echo.HeaderAuthorization, authorization)
	}
	response := httptest.NewRecorder()
	ctx := echo.New().NewContext(request, response)
	if err := handler(ctx); err != nil {
		t.Fatalf("retention handler returned error: %v", err)
	}
	return response
}

func stringifyRetentionLog(fields map[string]any) string {
	encoded, err := json.Marshal(fields)
	if err != nil {
		return ""
	}
	return string(encoded)
}
