package handler

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
)

type UserCryptoProfileService interface {
	Get(context.Context, string) (*apiService.EncryptedUserCryptoProfile, error)
	RewrapUserRootKey(context.Context, string, apiService.UserRootKeyRewrap) error
	MigrateUserCryptoProfile(context.Context, string, apiService.UserCryptoProfileMigration) (apiService.UserCryptoProfileMigrationResult, error)
}

func (handlers *IdentityHandlers) getUserCryptoProfile(ctx *echo.Context) error {
	user, authorized, err := handlers.authorizeApplicationRequest(ctx, "")
	if err != nil || !authorized {
		return err
	}
	if handlers.dependencies.CryptoProfiles == nil {
		return errors.New("user crypto profile service is unavailable")
	}
	profile, err := handlers.dependencies.CryptoProfiles.Get(ctx.Request().Context(), user.ID)
	if err != nil {
		return err
	}
	if profile == nil {
		return writeAPIError(ctx, http.StatusNotFound, "not_initialized")
	}
	response := userCryptoProfileResponse{
		VaultUnlockSalt:           base64.StdEncoding.EncodeToString(profile.VaultUnlockSalt),
		WrappedUserRootKey:        base64.StdEncoding.EncodeToString(profile.WrappedUserRootKey),
		EncryptedPersonalVaultKey: base64.StdEncoding.EncodeToString(profile.EncryptedPersonalVaultKey),
		EncryptionVersion:         profile.EncryptionVersion,
		UserEncryptionPublicKey:   profile.UserEncryptionPublicKey,
	}
	if profile.EncryptedUserPrivateKey != nil {
		response.EncryptedUserPrivateKey = base64.StdEncoding.EncodeToString(profile.EncryptedUserPrivateKey)
	}
	return ctx.JSON(http.StatusOK, response)
}

type userCryptoProfileResponse struct {
	VaultUnlockSalt           string          `json:"vaultUnlockSalt"`
	WrappedUserRootKey        string          `json:"wrappedUserRootKey"`
	EncryptedPersonalVaultKey string          `json:"encryptedPersonalVaultKey"`
	EncryptionVersion         int             `json:"encryptionVersion"`
	UserEncryptionPublicKey   json.RawMessage `json:"userEncryptionPublicKey,omitempty"`
	EncryptedUserPrivateKey   string          `json:"encryptedUserPrivateKey,omitempty"`
}

type rewrapUserRootKeyRequest struct {
	VaultUnlockSalt           string         `json:"vaultUnlockSalt"`
	WrappedUserRootKey        string         `json:"wrappedUserRootKey"`
	EncryptedPersonalVaultKey optionalString `json:"encryptedPersonalVaultKey"`
	EncryptionVersion         int            `json:"encryptionVersion"`
}

func (handlers *IdentityHandlers) rewrapUserRootKey(ctx *echo.Context) error {
	user, authorized, err := handlers.authorizeApplicationRequest(ctx, "key_material_mutation")
	if err != nil || !authorized {
		return err
	}
	if handlers.dependencies.CryptoProfiles == nil {
		return errors.New("user crypto profile service is unavailable")
	}
	request, err := httpapi.DecodeJSONBody[rewrapUserRootKeyRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || request.EncryptionVersion != 1 {
		return writeAPIError(ctx, http.StatusBadRequest, "invalid_rewrap")
	}
	var salt, wrapped, personalKey []byte
	defer func() {
		clear(salt)
		clear(wrapped)
		clear(personalKey)
	}()
	salt, err = httpapi.DecodeBoundedBase64(request.VaultUnlockSalt, 16, 16)
	if err != nil {
		return writeAPIError(ctx, http.StatusBadRequest, "invalid_rewrap")
	}
	wrapped, err = httpapi.DecodeBoundedBase64(request.WrappedUserRootKey, 13, httpapi.MaxEncryptedBlobBytes)
	if err != nil {
		return writeAPIError(ctx, http.StatusBadRequest, "invalid_rewrap")
	}
	if request.EncryptedPersonalVaultKey.Set {
		personalKey, err = httpapi.DecodeBoundedBase64(request.EncryptedPersonalVaultKey.Value, 13, httpapi.MaxEncryptedBlobBytes)
		if err != nil {
			return writeAPIError(ctx, http.StatusBadRequest, "invalid_rewrap")
		}
	}
	err = handlers.dependencies.CryptoProfiles.RewrapUserRootKey(ctx.Request().Context(), user.ID, apiService.UserRootKeyRewrap{
		VaultUnlockSalt:           salt,
		WrappedUserRootKey:        wrapped,
		EncryptedPersonalVaultKey: personalKey,
		EncryptionVersion:         request.EncryptionVersion,
	})
	if err != nil {
		return err
	}
	return ctx.NoContent(http.StatusNoContent)
}

type profileWrapperMigrationRequest struct {
	ExpectedCiphertext    string `json:"expectedCiphertext"`
	ReplacementCiphertext string `json:"replacementCiphertext"`
}

type optionalProfileWrapperMigration struct {
	Value profileWrapperMigrationRequest
	Set   bool
}

func (value *optionalProfileWrapperMigration) UnmarshalJSON(raw []byte) error {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return errors.New("profile wrapper migration must be an object")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(trimmed, &fields); err != nil || fields == nil {
		return errors.New("profile wrapper migration must be an object")
	}
	for name := range fields {
		if name != "expectedCiphertext" && name != "replacementCiphertext" {
			return errors.New("profile wrapper migration contains an unsupported field")
		}
	}
	decoder := json.NewDecoder(bytes.NewReader(trimmed))
	decoder.DisallowUnknownFields()
	var parsed profileWrapperMigrationRequest
	if err := decoder.Decode(&parsed); err != nil {
		return errors.New("profile wrapper migration is invalid")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return errors.New("profile wrapper migration is invalid")
	}
	value.Value = parsed
	value.Set = true
	return nil
}

type userCryptoProfileMigrationRequest struct {
	WrappedUserRootKey        optionalProfileWrapperMigration `json:"wrappedUserRootKey"`
	EncryptedPersonalVaultKey optionalProfileWrapperMigration `json:"encryptedPersonalVaultKey"`
}

func (handlers *IdentityHandlers) migrateUserCryptoProfile(ctx *echo.Context) error {
	user, authorized, err := handlers.authorizeApplicationRequest(ctx, "key_material_mutation")
	if err != nil || !authorized {
		return err
	}
	if handlers.dependencies.CryptoProfiles == nil {
		return errors.New("user crypto profile service is unavailable")
	}
	request, err := httpapi.DecodeJSONBody[userCryptoProfileMigrationRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || !request.WrappedUserRootKey.Set && !request.EncryptedPersonalVaultKey.Set {
		return writeAPIError(ctx, http.StatusBadRequest, "invalid_profile_migration")
	}
	migration := apiService.UserCryptoProfileMigration{}
	defer func() {
		clearProfileWrapperMigration(migration.WrappedUserRootKey)
		clearProfileWrapperMigration(migration.EncryptedPersonalVaultKey)
	}()
	migration.WrappedUserRootKey, err = decodeProfileWrapperMigration(request.WrappedUserRootKey)
	if err != nil {
		return writeAPIError(ctx, http.StatusBadRequest, "invalid_profile_migration")
	}
	migration.EncryptedPersonalVaultKey, err = decodeProfileWrapperMigration(request.EncryptedPersonalVaultKey)
	if err != nil {
		return writeAPIError(ctx, http.StatusBadRequest, "invalid_profile_migration")
	}
	result, err := handlers.dependencies.CryptoProfiles.MigrateUserCryptoProfile(ctx.Request().Context(), user.ID, migration)
	if err != nil {
		return err
	}
	if result == apiService.UserCryptoProfileMigrationConflict {
		return writeAPIError(ctx, http.StatusConflict, "profile_migration_conflict")
	}
	if result != apiService.UserCryptoProfileMigrationCommitted && result != apiService.UserCryptoProfileMigrationAlreadyCommitted {
		return errors.New("user crypto profile migration returned an unsupported result")
	}
	return ctx.NoContent(http.StatusNoContent)
}

func decodeProfileWrapperMigration(input optionalProfileWrapperMigration) (*apiService.UserCryptoProfileWrapperMigration, error) {
	if !input.Set {
		return nil, nil
	}
	expected, err := httpapi.DecodeBoundedBase64(input.Value.ExpectedCiphertext, 29, httpapi.MaxEncryptedBlobBytes)
	if err != nil {
		return nil, err
	}
	replacement, err := httpapi.DecodeBoundedBase64(input.Value.ReplacementCiphertext, 29, httpapi.MaxEncryptedBlobBytes)
	if err != nil {
		clear(expected)
		return nil, err
	}
	if len(expected) == 0 || expected[0] != 1 || len(replacement) == 0 || replacement[0] != 2 {
		clear(expected)
		clear(replacement)
		return nil, fmt.Errorf("profile wrapper migration version is unsupported")
	}
	return &apiService.UserCryptoProfileWrapperMigration{ExpectedCiphertext: expected, ReplacementCiphertext: replacement}, nil
}

func clearProfileWrapperMigration(migration *apiService.UserCryptoProfileWrapperMigration) {
	if migration == nil {
		return
	}
	clear(migration.ExpectedCiphertext)
	clear(migration.ReplacementCiphertext)
}

func (handlers *IdentityHandlers) AuthorizeApplicationRequest(ctx *echo.Context, mutation string) (string, bool, error) {
	user, authorized, err := handlers.AuthorizeApplicationUserRequest(ctx, mutation)
	if err != nil || !authorized {
		return "", authorized, err
	}
	return user.ID, true, nil
}

func (handlers *IdentityHandlers) AuthorizeApplicationUserRequest(ctx *echo.Context, mutation string) (apiService.ApplicationUser, bool, error) {
	return handlers.authorizeApplicationRequest(ctx, mutation)
}

func (handlers *IdentityHandlers) authorizeApplicationRequest(ctx *echo.Context, mutation string) (apiService.ApplicationUser, bool, error) {
	request := ctx.Request()
	result, err := handlers.dependencies.Authenticator.Authorize(request.Context(), apiService.RequestAuthorization{
		Credentials: apiService.SessionCredentials{
			AuthorizationPresent: len(request.Header.Values("Authorization")) > 0,
			CookieHeader:         request.Header.Get("Cookie"),
			TrustedProxy:         httpapi.IsProxyRequest(ctx),
		},
		Assurance: apiService.AssuranceFreshProvider,
		Mutation:  mutation,
	})
	if err != nil {
		return apiService.ApplicationUser{}, false, err
	}
	if result.Failure != nil {
		if result.Failure.RetryAfterSeconds > 0 {
			ctx.Response().Header().Set("Retry-After", fmt.Sprint(result.Failure.RetryAfterSeconds))
		}
		return apiService.ApplicationUser{}, false, writeAPIError(ctx, result.Failure.Status, result.Failure.Code)
	}
	if result.User == nil {
		return apiService.ApplicationUser{}, false, errors.New("application authentication returned no user")
	}
	return *result.User, true, nil
}
