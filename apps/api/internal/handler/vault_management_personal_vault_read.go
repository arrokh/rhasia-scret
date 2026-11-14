package handler

import (
	"errors"
	"net/http"

	"github.com/labstack/echo/v5"
)

type personalVaultResponse struct {
	ID        string `json:"id"`
	Lifecycle string `json:"lifecycle"`
}

func (handlers *VaultManagementHandlers) getPersonalVault(ctx *echo.Context) error {
	if handlers.dependencies.Authorizer == nil {
		return errors.New("application request authorizer is unavailable")
	}
	ownerID, authorized, err := handlers.dependencies.Authorizer.AuthorizeApplicationRequest(ctx, "")
	if err != nil || !authorized {
		return err
	}
	if handlers.dependencies.PersonalVaults == nil {
		return errors.New("Personal Vault repository is unavailable")
	}
	vault, err := handlers.dependencies.PersonalVaults.EnsureForOwner(ctx.Request().Context(), ownerID)
	if err != nil {
		return err
	}
	return ctx.JSON(http.StatusOK, personalVaultResponse{ID: vault.ID, Lifecycle: string(vault.Lifecycle)})
}
