package http

import (
	"errors"
	"net/http"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	vaultapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/vault-management"
)

type destructiveResetRequest struct {
	Confirmation string `json:"confirmation"`
}

func (handlers *Handlers) getDestructiveResetEligibility(ctx *echo.Context) error {
	if handlers.dependencies.Authorizer == nil {
		return errors.New("application request authorizer is unavailable")
	}
	userID, authorized, err := handlers.dependencies.Authorizer.AuthorizeApplicationRequest(ctx, "")
	if err != nil || !authorized {
		return err
	}
	if handlers.dependencies.Resets == nil {
		return errors.New("Destructive Personal Vault reset is unavailable")
	}
	eligibility, err := handlers.dependencies.Resets.GetEligibility(ctx.Request().Context(), userID)
	if err != nil {
		return err
	}
	ctx.Response().Header().Set(echo.HeaderCacheControl, "no-store")
	return ctx.JSON(http.StatusOK, eligibility)
}

func (handlers *Handlers) postDestructiveReset(ctx *echo.Context) error {
	if handlers.dependencies.Authorizer == nil {
		return errors.New("application request authorizer is unavailable")
	}
	userID, authorized, err := handlers.dependencies.Authorizer.AuthorizeApplicationRequest(ctx, "destructive_mutation")
	if err != nil || !authorized {
		return err
	}
	request, err := httpapi.DecodeJSONBody[destructiveResetRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || request.Confirmation == "" {
		return writePersonalVaultError(ctx, http.StatusBadRequest, "invalid_confirmation")
	}
	if handlers.dependencies.Resets == nil {
		return writePersonalVaultError(ctx, http.StatusInternalServerError, "destructive_reset_failed")
	}
	err = vaultapp.DestructivelyResetPersonalVault(ctx.Request().Context(), userID, request.Confirmation, handlers.dependencies.Resets)
	if err == nil {
		return ctx.NoContent(http.StatusNoContent)
	}
	var invalidConfirmation vaultapp.InvalidDestructiveResetConfirmationError
	if errors.As(err, &invalidConfirmation) {
		return writePersonalVaultError(ctx, http.StatusBadRequest, "invalid_confirmation")
	}
	var passkeyRecoveryEnrolled vaultapp.PasskeyRecoveryAlreadyEnrolledError
	if errors.As(err, &passkeyRecoveryEnrolled) {
		return writePersonalVaultError(ctx, http.StatusConflict, "passkey_recovery_available")
	}
	var activeOwnedVaults vaultapp.ActiveOwnedSharedVaultsPreventResetError
	if errors.As(err, &activeOwnedVaults) {
		return ctx.JSON(http.StatusConflict, struct {
			Error string `json:"error"`
			Count int64  `json:"count"`
		}{Error: "owned_shared_vaults_exist", Count: activeOwnedVaults.Count})
	}
	return writePersonalVaultError(ctx, http.StatusInternalServerError, "destructive_reset_failed")
}
