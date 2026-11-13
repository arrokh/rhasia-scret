package http

import (
	"errors"
	"net/http"
	"time"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/account-deletion/application"
	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity/application"
)

type DeleteMeHandlers struct {
	authorizer ApplicationUserAuthorizer
	repository application.DeletionRepository
	sender     application.CompletionEmailSender
	webOrigin  string
	now        func() time.Time
}

func NewDeleteMeHandlers(authorizer ApplicationUserAuthorizer, repository application.DeletionRepository, sender application.CompletionEmailSender, webOrigin string, now func() time.Time) *DeleteMeHandlers {
	if now == nil {
		now = time.Now
	}
	return &DeleteMeHandlers{authorizer: authorizer, repository: repository, sender: sender, webOrigin: webOrigin, now: now}
}

func (handlers *DeleteMeHandlers) OperationHandlers() map[string]httpapi.OperationHandler {
	return map[string]httpapi.OperationHandler{"deleteMe": handlers.deleteMe}
}

func (handlers *DeleteMeHandlers) deleteMe(ctx *echo.Context) error {
	ctx.Response().Header().Set(echo.HeaderCacheControl, "no-store")
	if !isSameOriginBrowserRequest(ctx.Request(), handlers.webOrigin) {
		return writeDeletionError(ctx, http.StatusForbidden, "same_origin_required")
	}
	authorizationCookie, err := ctx.Cookie(deletionAuthorizationCookieName)
	if err != nil || !application.ValidDeletionAuthorizationToken(authorizationCookie.Value) {
		return writeDeletionError(ctx, http.StatusUnauthorized, "deletion_reauthentication_required")
	}
	if handlers.repository == nil {
		return writeDeletionError(ctx, http.StatusServiceUnavailable, "account_deletion_failed")
	}
	authorizationToken := authorizationCookie.Value
	completed, err := handlers.repository.FindCompletedDeletion(ctx.Request().Context(), authorizationToken)
	if err != nil {
		return err
	}
	if completed != nil {
		clearPasswordlessSessionCookies(ctx)
		clearDeletionAuthorizationCookie(ctx)
		return ctx.JSON(http.StatusOK, deletionResponse{ReceiptID: completed.ReceiptID, EmailDelivery: completed.EmailDelivery})
	}
	if handlers.authorizer == nil {
		return writeDeletionError(ctx, http.StatusServiceUnavailable, "account_deletion_failed")
	}
	user, authorized, err := handlers.authorizer.AuthorizeApplicationUserRequest(ctx, "destructive_mutation")
	if err != nil || !authorized {
		return err
	}
	body, err := httpapi.DecodeJSONBody[deletionRequestBody](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil {
		return writeDeletionError(ctx, http.StatusBadRequest, "invalid_deletion_request")
	}
	request, valid := body.applicationRequest()
	if !valid {
		return writeDeletionError(ctx, http.StatusBadRequest, "invalid_deletion_request")
	}
	if err := application.ValidateDeletionRequest(request); err != nil {
		return mapDeletionValidationError(ctx, err)
	}
	completedDeletion, err := application.CompleteDeletion(
		ctx.Request().Context(), handlers.repository, handlers.sender, user.ID, authorizationToken, request, handlers.now(),
	)
	if err != nil {
		return mapDeletionOperationError(ctx, err)
	}
	clearPasswordlessSessionCookies(ctx)
	clearDeletionAuthorizationCookie(ctx)
	return ctx.JSON(http.StatusOK, deletionResponse{ReceiptID: completedDeletion.Deletion.ReceiptID, EmailDelivery: completedDeletion.EmailDelivery})
}

type deletionRequestBody struct {
	Confirmation   *string                      `json:"confirmation"`
	Acknowledged   *bool                        `json:"acknowledged"`
	VaultDecisions *[]application.VaultDecision `json:"vaultDecisions"`
}

func (body deletionRequestBody) applicationRequest() (application.DeletionRequest, bool) {
	if body.Confirmation == nil || body.Acknowledged == nil || body.VaultDecisions == nil || len(*body.VaultDecisions) > 128 {
		return application.DeletionRequest{}, false
	}
	for _, decision := range *body.VaultDecisions {
		if !application.ValidDeletionOpaqueIdentifier(decision.VaultID) ||
			decision.Action != application.VaultActionDelete && decision.Action != application.VaultActionTransfer ||
			decision.TransferToUserID.Present && !application.ValidDeletionOpaqueIdentifier(decision.TransferToUserID.Value) {
			return application.DeletionRequest{}, false
		}
	}
	return application.DeletionRequest{
		Confirmation:   *body.Confirmation,
		Acknowledged:   *body.Acknowledged,
		VaultDecisions: *body.VaultDecisions,
	}, true
}

type deletionResponse struct {
	ReceiptID     string `json:"receiptId"`
	EmailDelivery string `json:"emailDelivery"`
}

func mapDeletionValidationError(ctx *echo.Context, err error) error {
	switch {
	case errors.Is(err, application.ErrInvalidDeletionConfirmation):
		return writeDeletionError(ctx, http.StatusBadRequest, "invalid_confirmation")
	case errors.Is(err, application.ErrDeletionAcknowledgementRequired):
		return writeDeletionError(ctx, http.StatusBadRequest, "acknowledgement_required")
	case errors.Is(err, application.ErrInvalidDeletionTransferTarget):
		return writeDeletionError(ctx, http.StatusBadRequest, "invalid_transfer_target")
	case errors.Is(err, application.ErrInvalidDeletionVaultDecisions):
		return writeDeletionError(ctx, http.StatusBadRequest, "invalid_vault_decisions")
	default:
		return writeDeletionError(ctx, http.StatusBadRequest, "invalid_deletion_request")
	}
}

func mapDeletionOperationError(ctx *echo.Context, err error) error {
	if errors.Is(err, application.ErrDeletionAuthorization) {
		return writeDeletionError(ctx, http.StatusUnauthorized, "deletion_reauthentication_required")
	}
	if errors.Is(err, application.ErrDeletionPlanStale) {
		return writeDeletionError(ctx, http.StatusConflict, "deletion_plan_stale")
	}
	return writeDeletionError(ctx, http.StatusServiceUnavailable, "account_deletion_failed")
}

func clearDeletionAuthorizationCookie(ctx *echo.Context) {
	ctx.SetCookie(&http.Cookie{
		Name:     deletionAuthorizationCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	})
}

func clearPasswordlessSessionCookies(ctx *echo.Context) {
	for _, name := range []string{
		identityapp.PasswordlessAccessCookie,
		identityapp.PasswordlessRefreshCookie,
		identityapp.PasswordlessAssertionCookie,
	} {
		ctx.SetCookie(&http.Cookie{
			Name:     name,
			Value:    "",
			Path:     "/",
			MaxAge:   -1,
			HttpOnly: name != identityapp.AuthReturnPathCookie,
			Secure:   true,
			SameSite: http.SameSiteLaxMode,
		})
	}
}

func writeDeletionError(ctx *echo.Context, status int, code string) error {
	return ctx.JSON(status, httpapi.ApiError{Error: code})
}
