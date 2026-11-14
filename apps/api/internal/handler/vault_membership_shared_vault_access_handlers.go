package handler

import (
	"encoding/base64"
	"errors"
	"net/http"

	"github.com/labstack/echo/v5"

	apiEntity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
)

type SharedVaultAccessHandlers struct {
	authorizer httpapi.ApplicationRequestAuthorizer
	access     apiService.SharedVaultAccessRepository
}

func NewSharedVaultAccessHandlers(
	authorizer httpapi.ApplicationRequestAuthorizer,
	access apiService.SharedVaultAccessRepository,
) *SharedVaultAccessHandlers {
	return &SharedVaultAccessHandlers{authorizer: authorizer, access: access}
}

func (handlers *SharedVaultAccessHandlers) OperationHandlers() map[string]httpapi.OperationHandler {
	return map[string]httpapi.OperationHandler{
		"getSharedvaults":                         handlers.list,
		"getSharedvaultsVaultId":                  handlers.get,
		"postSharedvaultsVaultIdKeywrapMigration": handlers.migrateKeyWrap,
	}
}

type sharedVaultAccountResponse struct {
	ID                string `json:"id"`
	EncryptedPayload  string `json:"encryptedPayload"`
	EncryptionVersion int    `json:"encryptionVersion"`
	Revision          int64  `json:"revision"`
}

type sharedVaultResponse struct {
	VaultID                     string                                           `json:"vaultId"`
	Role                        apiEntity.SharedVaultMemberRole                  `json:"role,omitempty"`
	EffectiveAccountPermissions apiEntity.EffectiveSharedVaultAccountPermissions `json:"effectiveAccountPermissions"`
	EncryptedName               string                                           `json:"encryptedName"`
	EncryptionVersion           int                                              `json:"encryptionVersion"`
	EncryptedVaultKey           string                                           `json:"encryptedVaultKey"`
	KeyVersion                  int64                                            `json:"keyVersion"`
	Accounts                    []sharedVaultAccountResponse                     `json:"accounts"`
}

func (handlers *SharedVaultAccessHandlers) list(ctx *echo.Context) error {
	userID, authorized, err := handlers.authorize(ctx)
	if err != nil || !authorized {
		return err
	}
	if handlers.access == nil {
		return errors.New("Shared Vault access repository is not configured")
	}
	vaults, err := handlers.access.ListForMember(ctx.Request().Context(), userID)
	if err != nil {
		return err
	}
	defer clearSharedVaultAccessValues(vaults)
	response := make([]sharedVaultResponse, len(vaults))
	for index := range vaults {
		response[index] = sharedVaultResponseFor(vaults[index], true)
	}
	return ctx.JSON(http.StatusOK, response)
}

func (handlers *SharedVaultAccessHandlers) get(ctx *echo.Context) error {
	userID, authorized, err := handlers.authorize(ctx)
	if err != nil || !authorized {
		return err
	}
	if handlers.access == nil {
		return errors.New("Shared Vault access repository is not configured")
	}
	vault, err := handlers.access.GetForMember(ctx.Request().Context(), userID, ctx.Param("vaultId"))
	if err != nil {
		return err
	}
	if vault == nil {
		return ctx.JSON(http.StatusNotFound, httpapi.ApiError{Error: "shared_vault_unavailable"})
	}
	defer clearSharedVaultAccessValue(vault)
	return ctx.JSON(http.StatusOK, sharedVaultResponseFor(*vault, false))
}

func (handlers *SharedVaultAccessHandlers) authorize(ctx *echo.Context) (string, bool, error) {
	if handlers.authorizer == nil {
		return "", false, errors.New("application request authorizer is not configured")
	}
	userID, authorized, err := handlers.authorizer.AuthorizeApplicationRequest(ctx, "")
	if err != nil || !authorized {
		return "", authorized, err
	}
	if userID == "" {
		return "", false, errors.New("application request authorizer returned an empty user ID")
	}
	return userID, true, nil
}

func sharedVaultResponseFor(vault apiService.SharedVaultAccess, includeRole bool) sharedVaultResponse {
	accounts := make([]sharedVaultAccountResponse, len(vault.Accounts))
	for index := range vault.Accounts {
		account := vault.Accounts[index]
		accounts[index] = sharedVaultAccountResponse{
			ID:                account.ID,
			EncryptedPayload:  base64.StdEncoding.EncodeToString(account.EncryptedPayload),
			EncryptionVersion: account.EncryptionVersion,
			Revision:          account.Revision,
		}
	}
	response := sharedVaultResponse{
		VaultID:                     vault.VaultID,
		EffectiveAccountPermissions: vault.EffectiveAccountPermissions,
		EncryptedName:               base64.StdEncoding.EncodeToString(vault.EncryptedName),
		EncryptionVersion:           vault.EncryptionVersion,
		EncryptedVaultKey:           base64.StdEncoding.EncodeToString(vault.EncryptedVaultKey),
		KeyVersion:                  vault.KeyVersion,
		Accounts:                    accounts,
	}
	if includeRole {
		response.Role = vault.Role
	}
	return response
}

func clearSharedVaultAccessValues(vaults []apiService.SharedVaultAccess) {
	for index := range vaults {
		clearSharedVaultAccessValue(&vaults[index])
	}
}

func clearSharedVaultAccessValue(vault *apiService.SharedVaultAccess) {
	if vault == nil {
		return
	}
	clear(vault.EncryptedName)
	clear(vault.EncryptedVaultKey)
	for index := range vault.Accounts {
		clear(vault.Accounts[index].EncryptedPayload)
	}
}
