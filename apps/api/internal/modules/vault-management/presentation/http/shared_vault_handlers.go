package http

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	identity "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity"
	vaultapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-management/application"
)

type createSharedVaultRequest struct {
	VaultID                json.RawMessage             `json:"vaultId"`
	EncryptedName          string                      `json:"encryptedName"`
	EncryptedOwnerVaultKey string                      `json:"encryptedOwnerVaultKey"`
	ExpectedOwnerPublicKey json.RawMessage             `json:"expectedOwnerPublicKey"`
	EncryptionVersion      httpapi.PositiveSafeInteger `json:"encryptionVersion"`
}

type renameSharedVaultRequest struct {
	EncryptedName      string                      `json:"encryptedName"`
	EncryptionVersion  httpapi.PositiveSafeInteger `json:"encryptionVersion"`
	ExpectedKeyVersion httpapi.PositiveSafeInteger `json:"expectedKeyVersion"`
}

func (handlers *Handlers) createSharedVault(ctx *echo.Context) error {
	if handlers.dependencies.Authorizer == nil {
		return errors.New("application request authorizer is unavailable")
	}
	ownerID, authorized, err := handlers.dependencies.Authorizer.AuthorizeApplicationRequest(ctx, "vault_mutation")
	if err != nil || !authorized {
		return err
	}
	if handlers.dependencies.SharedVaults == nil {
		return errors.New("Shared Vault repository is unavailable")
	}
	request, err := httpapi.DecodeJSONBody[createSharedVaultRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || request.EncryptionVersion != 1 {
		return writePersonalVaultError(ctx, http.StatusBadRequest, "invalid_vault")
	}
	vaultID, validVaultID := parseOptionalSharedVaultID(request.VaultID)
	if !validVaultID {
		return writePersonalVaultError(ctx, http.StatusBadRequest, "invalid_vault")
	}
	publicKey, err := identity.ParsePublicEncryptionKey(request.ExpectedOwnerPublicKey)
	if err != nil {
		return writePersonalVaultError(ctx, http.StatusBadRequest, "invalid_vault")
	}
	encryptedName, err := httpapi.DecodeBoundedBase64(request.EncryptedName, 13, httpapi.MaxEncryptedBlobBytes)
	if err != nil {
		return writePersonalVaultError(ctx, http.StatusBadRequest, "invalid_vault")
	}
	defer clear(encryptedName)
	encryptedOwnerKey, err := httpapi.DecodeBoundedBase64(request.EncryptedOwnerVaultKey, 13, httpapi.MaxEncryptedBlobBytes)
	if err != nil {
		return writePersonalVaultError(ctx, http.StatusBadRequest, "invalid_vault")
	}
	defer clear(encryptedOwnerKey)

	created, err := handlers.dependencies.SharedVaults.Create(ctx.Request().Context(), ownerID, vaultapp.NewSharedVault{
		ID:                     vaultID,
		EncryptedName:          encryptedName,
		EncryptedOwnerVaultKey: encryptedOwnerKey,
		ExpectedOwnerPublicKey: publicKey,
		EncryptionVersion:      int(request.EncryptionVersion),
	})
	if errors.Is(err, vaultapp.ErrSharedVaultIdentityConflict) {
		return writePersonalVaultError(ctx, http.StatusConflict, "stale_user_encryption_identity")
	}
	if err != nil {
		return err
	}
	return ctx.JSON(http.StatusCreated, map[string]string{"id": created.ID})
}

func (handlers *Handlers) renameSharedVault(ctx *echo.Context) error {
	if handlers.dependencies.Authorizer == nil {
		return errors.New("application request authorizer is unavailable")
	}
	ownerID, authorized, err := handlers.dependencies.Authorizer.AuthorizeApplicationRequest(ctx, "vault_mutation")
	if err != nil || !authorized {
		return err
	}
	if handlers.dependencies.SharedVaults == nil {
		return errors.New("Shared Vault repository is unavailable")
	}
	request, err := httpapi.DecodeJSONBody[renameSharedVaultRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || request.EncryptionVersion != 1 || request.ExpectedKeyVersion < 1 {
		return writePersonalVaultError(ctx, http.StatusBadRequest, "invalid_vault_name")
	}
	encryptedName, err := httpapi.DecodeBoundedBase64(request.EncryptedName, 13, httpapi.MaxEncryptedBlobBytes)
	if err != nil {
		return writePersonalVaultError(ctx, http.StatusBadRequest, "invalid_vault_name")
	}
	defer clear(encryptedName)

	renamed, err := handlers.dependencies.SharedVaults.Rename(
		ctx.Request().Context(), ownerID, ctx.Param("vaultId"), encryptedName,
		int(request.EncryptionVersion), int64(request.ExpectedKeyVersion),
	)
	if errors.Is(err, vaultapp.ErrSharedVaultKeyVersionConflict) {
		return writePersonalVaultError(ctx, http.StatusConflict, "stale_key_version")
	}
	if err != nil {
		return err
	}
	if !renamed {
		return writePersonalVaultError(ctx, http.StatusNotFound, "owner_access_required")
	}
	return ctx.NoContent(http.StatusNoContent)
}

func parseOptionalSharedVaultID(raw json.RawMessage) (string, bool) {
	if len(raw) == 0 {
		return "", true
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil || !validSharedVaultID(value) {
		return "", false
	}
	return value, true
}

func validSharedVaultID(value string) bool {
	if len(value) < 16 || len(value) > 128 {
		return false
	}
	for _, character := range value {
		if !(character >= 'A' && character <= 'Z') && !(character >= 'a' && character <= 'z') &&
			!(character >= '0' && character <= '9') && character != '_' && character != '-' {
			return false
		}
	}
	return true
}
