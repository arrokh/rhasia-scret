package http

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	retentionapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/retention"
)

type Purger interface {
	Purge(context.Context, time.Time) (retentionapp.PurgeReport, error)
}

type JobIDGenerator func() (string, error)

type Handlers struct {
	secret   string
	purger   Purger
	logger   httpapi.APIEventLogger
	clock    func() time.Time
	createID JobIDGenerator
}

func NewHandlers(secret string, purger Purger, logger httpapi.APIEventLogger, clock func() time.Time, createID JobIDGenerator) *Handlers {
	if clock == nil {
		clock = time.Now
	}
	if createID == nil {
		createID = newJobID
	}
	return &Handlers{secret: secret, purger: purger, logger: logger, clock: clock, createID: createID}
}

func (handlers *Handlers) OperationHandlers() map[string]httpapi.OperationHandler {
	return map[string]httpapi.OperationHandler{"getInternalRetentionpurge": handlers.purge}
}

type purgeResponse struct {
	JobID                   string `json:"jobId"`
	AccountCount            int    `json:"accountCount"`
	VaultCount              int    `json:"vaultCount"`
	AuditEventCount         int    `json:"auditEventCount"`
	AuthRecordsPurged       int64  `json:"authRecordsPurged"`
	AccountBacklogRemaining bool   `json:"accountBacklogRemaining"`
	VaultBacklogRemaining   bool   `json:"vaultBacklogRemaining"`
	AuditBacklogRemaining   bool   `json:"auditBacklogRemaining"`
	AuthBacklogRemaining    bool   `json:"authBacklogRemaining"`
}

func (handlers *Handlers) purge(ctx *echo.Context) error {
	if ctx.Request().Method == http.MethodHead {
		return cacheControlJSON(ctx, http.StatusMethodNotAllowed, httpapi.ApiError{Error: "method_not_allowed"})
	}
	if handlers == nil || !secretConfigured(handlers.secret) {
		return cacheControlJSON(ctx, http.StatusServiceUnavailable, httpapi.ApiError{Error: "retention_purge_not_configured"})
	}
	authorizationValues := ctx.Request().Header.Values(echo.HeaderAuthorization)
	if len(authorizationValues) != 1 || !authorized(authorizationValues[0], handlers.secret) {
		return cacheControlJSON(ctx, http.StatusUnauthorized, httpapi.ApiError{Error: "unauthorized"})
	}
	if handlers.purger == nil {
		return errors.New("retention purge service is not configured")
	}
	jobID, err := handlers.createID()
	if err != nil {
		return err
	}
	report, err := handlers.purger.Purge(ctx.Request().Context(), handlers.clock())
	if err != nil {
		if handlers.logger != nil {
			handlers.logger.Log("error", "retention_purge_failed", map[string]any{"jobId": jobID})
		}
		return cacheControlJSON(ctx, http.StatusInternalServerError, map[string]any{"error": "retention_purge_failed", "jobId": jobID})
	}
	response := purgeResponse{
		JobID: jobID, AccountCount: len(report.AccountIDs), VaultCount: len(report.VaultIDs),
		AuditEventCount: len(report.AuditEventIDs), AuthRecordsPurged: report.AuthRecordsPurged,
		AccountBacklogRemaining: report.AccountBacklogRemaining, VaultBacklogRemaining: report.VaultBacklogRemaining,
		AuditBacklogRemaining: report.AuditBacklogRemaining, AuthBacklogRemaining: report.AuthBacklogRemaining,
	}
	if handlers.logger != nil {
		handlers.logger.Log("info", "retention_purge_completed", map[string]any{
			"jobId": jobID, "accountCount": response.AccountCount, "vaultCount": response.VaultCount,
			"auditEventCount": response.AuditEventCount, "authRecordsPurged": response.AuthRecordsPurged,
			"accountBacklogRemaining": response.AccountBacklogRemaining, "vaultBacklogRemaining": response.VaultBacklogRemaining,
			"auditBacklogRemaining": response.AuditBacklogRemaining, "authBacklogRemaining": response.AuthBacklogRemaining,
		})
	}
	return cacheControlJSON(ctx, http.StatusOK, response)
}

func secretConfigured(secret string) bool {
	return len(utf16.Encode([]rune(secret))) >= 32
}

func authorized(header string, secret string) bool {
	provided := ""
	if strings.HasPrefix(header, "Bearer ") {
		provided = strings.TrimPrefix(header, "Bearer ")
	}
	providedDigest := sha256.Sum256([]byte(provided))
	secretDigest := sha256.Sum256([]byte(secret))
	return subtle.ConstantTimeCompare(providedDigest[:], secretDigest[:]) == 1
}

func cacheControlJSON(ctx *echo.Context, status int, body any) error {
	ctx.Response().Header().Set(echo.HeaderCacheControl, "no-store")
	return ctx.JSON(status, body)
}

func newJobID() (string, error) {
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(id[:]), nil
}
