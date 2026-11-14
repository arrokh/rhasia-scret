package http

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/identity"
	vaultapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/vault-management"
)

type PersonalVaultInitializer interface {
	Initialize(context.Context, string, vaultapp.PersonalVaultInitialization) error
}

type Dependencies struct {
	Authorizer     httpapi.ApplicationRequestAuthorizer
	Initializer    PersonalVaultInitializer
	PersonalVaults vaultapp.PersonalVaultRepository
	SharedVaults   vaultapp.SharedVaultRepository
	Resets         vaultapp.DestructivePersonalVaultResetRepository
}

type Handlers struct {
	dependencies Dependencies
}

func NewHandlers(dependencies Dependencies) *Handlers {
	return &Handlers{dependencies: dependencies}
}

func (handlers *Handlers) OperationHandlers() map[string]httpapi.OperationHandler {
	return map[string]httpapi.OperationHandler{
		"getPersonalvault":                     handlers.getPersonalVault,
		"postSharedvaults":                     handlers.createSharedVault,
		"patchSharedvaultsVaultId":             handlers.renameSharedVault,
		"postSharedvaultsVaultIdNameMigration": handlers.migrateSharedVaultName,
		"postPersonalvaultNameMigration":       handlers.migratePersonalVaultName,
		"postPersonalvaultInitialize":          handlers.initializePersonalVault,
		"getPersonalvaultDestructivereset":     handlers.getDestructiveResetEligibility,
		"postPersonalvaultDestructivereset":    handlers.postDestructiveReset,
	}
}

type personalVaultInitializationRequest struct {
	VaultUnlockSalt           string                     `json:"vaultUnlockSalt"`
	WrappedUserRootKey        string                     `json:"wrappedUserRootKey"`
	EncryptedPersonalVaultKey string                     `json:"encryptedPersonalVaultKey"`
	EncryptedVaultName        string                     `json:"encryptedVaultName"`
	UserEncryptionPublicKey   map[string]json.RawMessage `json:"userEncryptionPublicKey"`
	EncryptedUserPrivateKey   string                     `json:"encryptedUserPrivateKey"`
	UserEncryptionKeyVersion  int                        `json:"userEncryptionKeyVersion"`
	EncryptionVersion         int                        `json:"encryptionVersion"`
}

func (handlers *Handlers) initializePersonalVault(ctx *echo.Context) error {
	if handlers.dependencies.Authorizer == nil {
		return errors.New("application request authorizer is unavailable")
	}
	ownerID, authorized, err := handlers.dependencies.Authorizer.AuthorizeApplicationRequest(ctx, "key_material_mutation")
	if err != nil || !authorized {
		return err
	}
	if handlers.dependencies.Initializer == nil {
		return errors.New("Personal Vault initializer is unavailable")
	}
	request, err := httpapi.DecodeJSONBody[personalVaultInitializationRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || request.UserEncryptionKeyVersion != 1 || request.EncryptionVersion != 1 {
		return writePersonalVaultError(ctx, http.StatusBadRequest, "invalid_initialization")
	}
	publicKey, err := parsePersonalVaultPublicKey(request.UserEncryptionPublicKey)
	if err != nil {
		return writePersonalVaultError(ctx, http.StatusBadRequest, "invalid_initialization")
	}
	initialization := vaultapp.PersonalVaultInitialization{UserEncryptionPublicKey: publicKey}
	initialization.VaultUnlockSalt, err = httpapi.DecodeBoundedBase64(request.VaultUnlockSalt, 16, 16)
	if err != nil {
		return writePersonalVaultError(ctx, http.StatusBadRequest, "invalid_initialization")
	}
	defer clearPersonalVaultInitialization(&initialization)
	initialization.WrappedUserRootKey, err = httpapi.DecodeBoundedBase64(request.WrappedUserRootKey, 13, httpapi.MaxEncryptedBlobBytes)
	if err != nil {
		return writePersonalVaultError(ctx, http.StatusBadRequest, "invalid_initialization")
	}
	initialization.EncryptedPersonalVaultKey, err = httpapi.DecodeBoundedBase64(request.EncryptedPersonalVaultKey, 13, httpapi.MaxEncryptedBlobBytes)
	if err != nil {
		return writePersonalVaultError(ctx, http.StatusBadRequest, "invalid_initialization")
	}
	initialization.EncryptedVaultName, err = httpapi.DecodeBoundedBase64(request.EncryptedVaultName, 13, httpapi.MaxEncryptedBlobBytes)
	if err != nil {
		return writePersonalVaultError(ctx, http.StatusBadRequest, "invalid_initialization")
	}
	initialization.EncryptedUserPrivateKey, err = httpapi.DecodeBoundedBase64(request.EncryptedUserPrivateKey, 13, httpapi.MaxEncryptedBlobBytes)
	if err != nil {
		return writePersonalVaultError(ctx, http.StatusBadRequest, "invalid_initialization")
	}
	initialization.UserEncryptionKeyVersion = request.UserEncryptionKeyVersion
	initialization.EncryptionVersion = request.EncryptionVersion
	if err := handlers.dependencies.Initializer.Initialize(ctx.Request().Context(), ownerID, initialization); err != nil {
		return err
	}
	return ctx.NoContent(http.StatusNoContent)
}

func parsePersonalVaultPublicKey(fields map[string]json.RawMessage) (identityapp.UserEncryptionPublicKey, error) {
	serialized, err := json.Marshal(fields)
	if err != nil {
		return identityapp.UserEncryptionPublicKey{}, errors.New("Personal Vault public encryption key is invalid")
	}
	return identityapp.ParseUserEncryptionPublicKey(serialized)
}

func clearPersonalVaultInitialization(initialization *vaultapp.PersonalVaultInitialization) {
	clear(initialization.VaultUnlockSalt)
	clear(initialization.WrappedUserRootKey)
	clear(initialization.EncryptedPersonalVaultKey)
	clear(initialization.EncryptedVaultName)
	clear(initialization.EncryptedUserPrivateKey)
}

func writePersonalVaultError(ctx *echo.Context, status int, code string) error {
	return ctx.JSON(status, httpapi.ApiError{Error: code})
}
