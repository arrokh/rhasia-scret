package http

import (
	"errors"
	"net/http"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	vaultapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/vault-management"
)

type SharedVaultRecoveryHandlers struct {
	authorizer httpapi.ApplicationRequestAuthorizer
	recovery   vaultapp.SharedVaultRecoveryRepository
}

func NewSharedVaultRecoveryHandlers(
	authorizer httpapi.ApplicationRequestAuthorizer,
	recovery vaultapp.SharedVaultRecoveryRepository,
) *SharedVaultRecoveryHandlers {
	return &SharedVaultRecoveryHandlers{authorizer: authorizer, recovery: recovery}
}

func (handlers *SharedVaultRecoveryHandlers) OperationHandlers() map[string]httpapi.OperationHandler {
	return map[string]httpapi.OperationHandler{
		"deleteSharedvaultsVaultIdLifecycle": handlers.delete,
		"postSharedvaultsVaultIdLifecycle":   handlers.restore,
	}
}

func (handlers *SharedVaultRecoveryHandlers) delete(ctx *echo.Context) error {
	return handlers.change(ctx, true)
}

func (handlers *SharedVaultRecoveryHandlers) restore(ctx *echo.Context) error {
	return handlers.change(ctx, false)
}

func (handlers *SharedVaultRecoveryHandlers) change(ctx *echo.Context, deleting bool) error {
	if handlers.authorizer == nil {
		return errors.New("application request authorizer is not configured")
	}
	ownerID, authorized, err := handlers.authorizer.AuthorizeApplicationRequest(ctx, "destructive_mutation")
	if err != nil || !authorized {
		return err
	}
	if ownerID == "" {
		return errors.New("application request authorizer returned an empty user ID")
	}
	if handlers.recovery == nil {
		return errors.New("Shared Vault recovery repository is not configured")
	}
	var changed bool
	if deleting {
		changed, err = handlers.recovery.Delete(ctx.Request().Context(), ownerID, ctx.Param("vaultId"))
	} else {
		changed, err = handlers.recovery.Restore(ctx.Request().Context(), ownerID, ctx.Param("vaultId"))
	}
	if err != nil {
		return err
	}
	if !changed {
		return ctx.JSON(http.StatusNotFound, httpapi.ApiError{Error: "shared_vault_unavailable"})
	}
	return ctx.NoContent(http.StatusNoContent)
}
