package http

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	accountapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/authenticator-account"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

type SharedAccountHandlers struct {
	authorizer httpapi.ApplicationRequestAuthorizer
	accounts   accountapp.SharedAccountRepository
}

func NewSharedAccountHandlers(
	authorizer httpapi.ApplicationRequestAuthorizer,
	accounts accountapp.SharedAccountRepository,
) *SharedAccountHandlers {
	return &SharedAccountHandlers{authorizer: authorizer, accounts: accounts}
}

func (handlers *SharedAccountHandlers) OperationHandlers() map[string]httpapi.OperationHandler {
	return map[string]httpapi.OperationHandler{
		"postSharedvaultsVaultIdAccountsMigration": handlers.migratePayload,
		"postSharedvaultsVaultIdAccounts":          handlers.create,
		"patchSharedvaultsVaultIdAccounts":         handlers.update,
		"deleteSharedvaultsVaultIdAccounts":        handlers.delete,
		"putSharedvaultsVaultIdAccounts":           handlers.restore,
	}
}

type sharedAccountPayloadRequest struct {
	EncryptedPayload   string                      `json:"encryptedPayload"`
	EncryptionVersion  httpapi.PositiveSafeInteger `json:"encryptionVersion"`
	ExpectedKeyVersion httpapi.PositiveSafeInteger `json:"expectedKeyVersion"`
}

type sharedAccountUpdateRequest struct {
	EncryptedPayload   string                      `json:"encryptedPayload"`
	EncryptionVersion  httpapi.PositiveSafeInteger `json:"encryptionVersion"`
	ExpectedKeyVersion httpapi.PositiveSafeInteger `json:"expectedKeyVersion"`
	AccountID          string                      `json:"accountId"`
	ExpectedRevision   httpapi.PositiveSafeInteger `json:"expectedRevision"`
}

type sharedAccountDeleteRequest struct {
	AccountID        string                      `json:"accountId"`
	ExpectedRevision httpapi.PositiveSafeInteger `json:"expectedRevision"`
}

type sharedAccountRestoreRequest struct {
	AccountID string `json:"accountId"`
}

type sharedAccountMigrationRequest struct {
	AccountID                   string                      `json:"accountId"`
	ExpectedRevision            httpapi.PositiveSafeInteger `json:"expectedRevision"`
	ExpectedKeyVersion          httpapi.PositiveSafeInteger `json:"expectedKeyVersion"`
	ExpectedEnvelopeVersion     httpapi.PositiveSafeInteger `json:"expectedEnvelopeVersion"`
	ReplacementEnvelopeVersion  httpapi.PositiveSafeInteger `json:"replacementEnvelopeVersion"`
	ExpectedCiphertextDigest    string                      `json:"expectedCiphertextDigest"`
	ReplacementCiphertextDigest string                      `json:"replacementCiphertextDigest"`
	ReplacementCiphertext       string                      `json:"replacementCiphertext"`
	OperationID                 string                      `json:"operationId"`
}

type sharedAccountMutationResponse struct {
	ID       string `json:"id"`
	Revision int64  `json:"revision"`
}

func (handlers *SharedAccountHandlers) create(ctx *echo.Context) error {
	actorUserID, authorized, err := handlers.authorize(ctx)
	if err != nil || !authorized {
		return err
	}
	if handlers.accounts == nil {
		return errors.New("Shared Account repository is not configured")
	}
	request, err := httpapi.DecodeJSONBody[sharedAccountPayloadRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || request.EncryptionVersion != 1 || request.ExpectedKeyVersion < 1 {
		return writeSharedAccountError(ctx, http.StatusBadRequest, "invalid_account")
	}
	payload, err := decodeSharedAccountPayload(request.EncryptedPayload)
	if err != nil {
		return writeSharedAccountError(ctx, http.StatusBadRequest, "invalid_account")
	}
	defer clear(payload)
	if payload[0] != 1 && payload[0] != 2 {
		return writeSharedAccountError(ctx, http.StatusBadRequest, "invalid_account")
	}
	result, err := handlers.accounts.Create(
		ctx.Request().Context(), actorUserID, ctx.Param("vaultId"), payload,
		int(request.EncryptionVersion), int64(request.ExpectedKeyVersion),
	)
	if err != nil {
		return err
	}
	if result.Status != accountapp.SharedAccountMutationSuccess {
		return writeSharedAccountMutationError(ctx, result.Status)
	}
	if result.Account == nil {
		return errors.New("Shared Account repository returned no created account")
	}
	defer result.Account.Clear()
	return ctx.JSON(http.StatusCreated, sharedAccountMutationResponse{ID: result.Account.ID, Revision: result.Account.Revision})
}

func (handlers *SharedAccountHandlers) update(ctx *echo.Context) error {
	actorUserID, authorized, err := handlers.authorize(ctx)
	if err != nil || !authorized {
		return err
	}
	if handlers.accounts == nil {
		return errors.New("Shared Account repository is not configured")
	}
	request, err := httpapi.DecodeJSONBody[sharedAccountUpdateRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || request.EncryptionVersion != 1 || request.ExpectedKeyVersion < 1 || request.ExpectedRevision < 1 ||
		!httpapi.ValidStringLength(request.AccountID, 1, 128) {
		return writeSharedAccountError(ctx, http.StatusBadRequest, "invalid_account")
	}
	payload, err := decodeSharedAccountPayload(request.EncryptedPayload)
	if err != nil {
		return writeSharedAccountError(ctx, http.StatusBadRequest, "invalid_account")
	}
	defer clear(payload)
	if payload[0] != 1 && payload[0] != 2 {
		return writeSharedAccountError(ctx, http.StatusBadRequest, "invalid_account")
	}
	result, err := handlers.accounts.Update(
		ctx.Request().Context(), actorUserID, ctx.Param("vaultId"), request.AccountID,
		int64(request.ExpectedRevision), payload, int(request.EncryptionVersion), int64(request.ExpectedKeyVersion),
	)
	if err != nil {
		return err
	}
	if result.Status != accountapp.SharedAccountMutationSuccess {
		return writeSharedAccountMutationError(ctx, result.Status)
	}
	if result.Account == nil {
		return errors.New("Shared Account repository returned no updated account")
	}
	defer result.Account.Clear()
	return ctx.JSON(http.StatusOK, sharedAccountMutationResponse{ID: result.Account.ID, Revision: result.Account.Revision})
}

func (handlers *SharedAccountHandlers) delete(ctx *echo.Context) error {
	actorUserID, authorized, err := handlers.authorize(ctx)
	if err != nil || !authorized {
		return err
	}
	if handlers.accounts == nil {
		return errors.New("Shared Account repository is not configured")
	}
	request, err := httpapi.DecodeJSONBody[sharedAccountDeleteRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || request.ExpectedRevision < 1 || !httpapi.ValidStringLength(request.AccountID, 1, 128) {
		return writeSharedAccountError(ctx, http.StatusBadRequest, "invalid_account")
	}
	result, err := handlers.accounts.Delete(
		ctx.Request().Context(), actorUserID, ctx.Param("vaultId"), request.AccountID, int64(request.ExpectedRevision),
	)
	if err != nil {
		return err
	}
	if result.Status != accountapp.SharedAccountMutationSuccess {
		return writeSharedAccountMutationError(ctx, result.Status)
	}
	return ctx.NoContent(http.StatusNoContent)
}

func (handlers *SharedAccountHandlers) restore(ctx *echo.Context) error {
	actorUserID, authorized, err := handlers.authorize(ctx)
	if err != nil || !authorized {
		return err
	}
	if handlers.accounts == nil {
		return errors.New("Shared Account repository is not configured")
	}
	request, err := httpapi.DecodeJSONBody[sharedAccountRestoreRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || !httpapi.ValidStringLength(request.AccountID, 1, 128) {
		return writeSharedAccountError(ctx, http.StatusBadRequest, "invalid_account")
	}
	result, err := handlers.accounts.Restore(ctx.Request().Context(), actorUserID, ctx.Param("vaultId"), request.AccountID)
	if err != nil {
		return err
	}
	if result.Status != accountapp.SharedAccountMutationSuccess {
		return writeSharedAccountMutationError(ctx, result.Status)
	}
	return ctx.NoContent(http.StatusNoContent)
}

func (handlers *SharedAccountHandlers) migratePayload(ctx *echo.Context) error {
	actorUserID, authorized, err := handlers.authorize(ctx)
	if err != nil || !authorized {
		return err
	}
	if handlers.accounts == nil {
		return errors.New("Shared Account repository is not configured")
	}
	request, err := httpapi.DecodeJSONBody[sharedAccountMigrationRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || !httpapi.ValidRouteParameter(request.AccountID) || request.ExpectedRevision < 1 || request.ExpectedKeyVersion < 1 ||
		request.ExpectedEnvelopeVersion != 1 || request.ReplacementEnvelopeVersion != 2 ||
		!sharedapp.HasSHA256Base64URLDigestShape(request.ExpectedCiphertextDigest) ||
		!sharedapp.HasSHA256Base64URLDigestShape(request.ReplacementCiphertextDigest) ||
		!sharedapp.HasSHA256Base64URLDigestShape(request.OperationID) ||
		request.OperationID != request.ReplacementCiphertextDigest {
		return writeSharedAccountError(ctx, http.StatusBadRequest, "invalid_account_migration")
	}
	replacement, err := httpapi.DecodeBoundedBase64(request.ReplacementCiphertext, 29, httpapi.MaxEncryptedBlobBytes)
	if err != nil {
		return writeSharedAccountError(ctx, http.StatusBadRequest, "invalid_account_migration")
	}
	defer clear(replacement)
	result, err := handlers.accounts.MigratePayload(
		ctx.Request().Context(), actorUserID, ctx.Param("vaultId"), request.AccountID,
		int64(request.ExpectedRevision), int64(request.ExpectedKeyVersion),
		sharedapp.EncryptedPayloadMigration{
			ExpectedEnvelopeVersion:     int(request.ExpectedEnvelopeVersion),
			ReplacementEnvelopeVersion:  int(request.ReplacementEnvelopeVersion),
			ExpectedCiphertextDigest:    request.ExpectedCiphertextDigest,
			ReplacementCiphertextDigest: request.ReplacementCiphertextDigest,
			ReplacementCiphertext:       replacement,
			OperationID:                 request.OperationID,
		},
	)
	if err != nil {
		return err
	}
	if result == sharedapp.EncryptedPayloadMigrationConflict {
		return writeSharedAccountError(ctx, http.StatusConflict, "account_migration_conflict")
	}
	if result != sharedapp.EncryptedPayloadMigrationCommitted && result != sharedapp.EncryptedPayloadMigrationAlreadyCommitted {
		return fmt.Errorf("Shared Account payload migration returned an unsupported result")
	}
	return ctx.NoContent(http.StatusNoContent)
}

func (handlers *SharedAccountHandlers) authorize(ctx *echo.Context) (string, bool, error) {
	if handlers.authorizer == nil {
		return "", false, errors.New("application request authorizer is not configured")
	}
	userID, authorized, err := handlers.authorizer.AuthorizeApplicationRequest(ctx, "account_mutation")
	if err != nil || !authorized {
		return "", authorized, err
	}
	if userID == "" {
		return "", false, errors.New("application request authorizer returned an empty user ID")
	}
	return userID, true, nil
}

func decodeSharedAccountPayload(value string) ([]byte, error) {
	return httpapi.DecodeBoundedBase64(value, 29, httpapi.MaxEncryptedBlobBytes)
}

func writeSharedAccountMutationError(ctx *echo.Context, status accountapp.SharedAccountMutationStatus) error {
	switch status {
	case accountapp.SharedAccountMutationVaultUnavailable:
		return writeSharedAccountError(ctx, http.StatusNotFound, "shared_vault_unavailable")
	case accountapp.SharedAccountMutationPermissionDenied:
		return writeSharedAccountError(ctx, http.StatusForbidden, "account_permission_required")
	case accountapp.SharedAccountMutationStaleRevision:
		return writeSharedAccountError(ctx, http.StatusConflict, "stale_revision")
	case accountapp.SharedAccountMutationStaleKeyVersion:
		return writeSharedAccountError(ctx, http.StatusConflict, "stale_key_version")
	case accountapp.SharedAccountMutationAccountUnavailable:
		return writeSharedAccountError(ctx, http.StatusNotFound, "account_unavailable")
	default:
		return writeSharedAccountError(ctx, http.StatusNotFound, "account_unavailable")
	}
}

func writeSharedAccountError(ctx *echo.Context, status int, code string) error {
	return ctx.JSON(status, httpapi.ApiError{Error: code})
}
