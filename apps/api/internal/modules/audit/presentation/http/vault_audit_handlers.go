package http

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/audit"
	auditapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/audit/application"
)

type VaultAuditHandlers struct {
	authorizer httpapi.ApplicationRequestAuthorizer
	audit      auditapp.VaultAuditRepository
}

func NewVaultAuditHandlers(authorizer httpapi.ApplicationRequestAuthorizer, repository auditapp.VaultAuditRepository) *VaultAuditHandlers {
	return &VaultAuditHandlers{authorizer: authorizer, audit: repository}
}

func (handlers *VaultAuditHandlers) OperationHandlers() map[string]httpapi.OperationHandler {
	return map[string]httpapi.OperationHandler{
		"getSharedvaultsVaultIdAuditevents":  handlers.list,
		"postSharedvaultsVaultIdAuditevents": handlers.recordSharedAccountAccess,
		"getVaultsVaultIdAuditevents":        handlers.list,
		"postVaultsVaultIdAuditevents":       handlers.recordPersonalAccountCopies,
	}
}

type sharedAccountAccessAuditRequest struct {
	EventType string `json:"eventType"`
	AccountID string `json:"accountId"`
}

type personalAccountCopiesAuditRequest struct {
	EventType  string   `json:"eventType"`
	AccountIDs []string `json:"accountIds"`
}

type auditEventResponse struct {
	ID          string  `json:"id"`
	EventType   string  `json:"eventType"`
	TargetID    *string `json:"targetId"`
	ActorUserID string  `json:"actorUserId"`
	ActorEmail  string  `json:"actorEmail"`
	CreatedAt   string  `json:"createdAt"`
}

type auditPageResponse struct {
	Events     []auditEventResponse `json:"events"`
	NextCursor *string              `json:"nextCursor"`
}

func (handlers *VaultAuditHandlers) recordSharedAccountAccess(ctx *echo.Context) error {
	actorID, authorized, err := handlers.authorize(ctx, "audit_event")
	if err != nil || !authorized {
		return err
	}
	if handlers.audit == nil {
		return errors.New("Vault audit repository is not configured")
	}
	request, err := httpapi.DecodeJSONBody[sharedAccountAccessAuditRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || request.EventType != string(audit.ActionAccountAccessed) || !httpapi.ValidStringLength(request.AccountID, 1, 128) {
		return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "invalid_audit_event"})
	}
	recorded, err := handlers.audit.RecordAccountAccess(ctx.Request().Context(), actorID, ctx.Param("vaultId"), request.AccountID)
	if err != nil {
		return err
	}
	if !recorded {
		return ctx.JSON(http.StatusNotFound, httpapi.ApiError{Error: "shared_vault_access_required"})
	}
	return ctx.NoContent(http.StatusNoContent)
}

func (handlers *VaultAuditHandlers) recordPersonalAccountCopies(ctx *echo.Context) error {
	ownerID, authorized, err := handlers.authorize(ctx, "account_mutation")
	if err != nil || !authorized {
		return err
	}
	if handlers.audit == nil {
		return errors.New("Vault audit repository is not configured")
	}
	request, err := httpapi.DecodeJSONBody[personalAccountCopiesAuditRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || request.EventType != string(audit.ActionAccountCopiedToLocal) || request.AccountIDs == nil ||
		len(request.AccountIDs) == 0 || len(request.AccountIDs) > auditapp.MaxAccountCopyAuditIDs {
		return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "invalid_copy_audit"})
	}
	seen := make(map[string]struct{}, len(request.AccountIDs))
	for _, accountID := range request.AccountIDs {
		if !httpapi.ValidStringLength(accountID, 1, 128) {
			return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "invalid_copy_audit"})
		}
		if _, duplicate := seen[accountID]; duplicate {
			return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "invalid_copy_audit"})
		}
		seen[accountID] = struct{}{}
	}
	recorded, err := handlers.audit.RecordPersonalAccountCopiesToLocal(ctx.Request().Context(), ownerID, ctx.Param("vaultId"), request.AccountIDs)
	if err != nil {
		return err
	}
	if !recorded {
		return ctx.JSON(http.StatusNotFound, httpapi.ApiError{Error: "owner_access_required"})
	}
	return ctx.NoContent(http.StatusNoContent)
}

func (handlers *VaultAuditHandlers) list(ctx *echo.Context) error {
	ownerID, authorized, err := handlers.authorize(ctx, "")
	if err != nil || !authorized {
		return err
	}
	if handlers.audit == nil {
		return errors.New("Vault audit repository is not configured")
	}
	query := ctx.QueryParams()
	filter, valid := parseAuditFilter(query)
	if !valid {
		return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "invalid_audit_filter"})
	}
	vaultID := ctx.Param("vaultId")
	scope, err := auditCursorScope(vaultID, filter)
	if err != nil {
		return err
	}
	pagination, paginationError := httpapi.ParseTimestampCursorPageRequest(query, scope, nil)
	if paginationError != "" {
		return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: paginationError})
	}
	page, err := handlers.audit.ListForOwner(ctx.Request().Context(), ownerID, vaultID, filter, pagination)
	if err != nil {
		return err
	}
	if page == nil {
		return ctx.JSON(http.StatusNotFound, httpapi.ApiError{Error: "owner_access_required"})
	}
	response := auditPageResponse{Events: make([]auditEventResponse, len(page.Items))}
	for index, event := range page.Items {
		response.Events[index] = auditEventResponse{
			ID: event.ID, EventType: event.EventType, TargetID: event.TargetID,
			ActorUserID: event.ActorUserID, ActorEmail: event.ActorEmail,
			CreatedAt: event.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		}
	}
	if page.NextCursor != nil {
		cursor, err := httpapi.EncodeTimestampCursor(*page.NextCursor, scope)
		if err != nil {
			return err
		}
		response.NextCursor = &cursor
	}
	return ctx.JSON(http.StatusOK, response)
}

func parseAuditFilter(query map[string][]string) (auditapp.VaultAuditFilter, bool) {
	var filter auditapp.VaultAuditFilter
	if values, present := query["accountId"]; present && len(values) > 0 {
		if !httpapi.ValidStringLength(values[0], 1, 128) {
			return filter, false
		}
		value := values[0]
		filter.AccountID = &value
	}
	if values, present := query["actorUserId"]; present && len(values) > 0 {
		if !httpapi.ValidStringLength(values[0], 1, 128) {
			return filter, false
		}
		value := values[0]
		filter.ActorUserID = &value
	}
	return filter, true
}

func auditCursorScope(vaultID string, filter auditapp.VaultAuditFilter) (string, error) {
	var accountID any
	if filter.AccountID != nil {
		accountID = *filter.AccountID
	}
	var actorUserID any
	if filter.ActorUserID != nil {
		actorUserID = *filter.ActorUserID
	}
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode([]any{"vault-audit", vaultID, accountID, actorUserID}); err != nil {
		return "", err
	}
	return strings.TrimSuffix(buffer.String(), "\n"), nil
}

func (handlers *VaultAuditHandlers) authorize(ctx *echo.Context, mutation string) (string, bool, error) {
	if handlers.authorizer == nil {
		return "", false, errors.New("application request authorizer is not configured")
	}
	userID, authorized, err := handlers.authorizer.AuthorizeApplicationRequest(ctx, mutation)
	if err != nil || !authorized {
		return "", authorized, err
	}
	if userID == "" {
		return "", false, errors.New("application request authorizer returned an empty user ID")
	}
	return userID, true, nil
}
