package http

import (
	"errors"
	"net/http"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

type sharedVaultKeyWrapMigrationRequest struct {
	ExpectedEnvelopeVersion     httpapi.PositiveSafeInteger `json:"expectedEnvelopeVersion"`
	ReplacementEnvelopeVersion  httpapi.PositiveSafeInteger `json:"replacementEnvelopeVersion"`
	ExpectedCiphertextDigest    string                      `json:"expectedCiphertextDigest"`
	ReplacementCiphertextDigest string                      `json:"replacementCiphertextDigest"`
	ReplacementCiphertext       string                      `json:"replacementCiphertext"`
	OperationID                 string                      `json:"operationId"`
	ExpectedKeyVersion          httpapi.PositiveSafeInteger `json:"expectedKeyVersion"`
}

func (handlers *SharedVaultAccessHandlers) migrateKeyWrap(ctx *echo.Context) error {
	userID, authorized, err := handlers.authorizeMutation(ctx)
	if err != nil || !authorized {
		return err
	}
	if handlers.access == nil {
		return errors.New("Shared Vault access repository is not configured")
	}
	request, err := httpapi.DecodeJSONBody[sharedVaultKeyWrapMigrationRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || !validSharedVaultKeyWrapMigrationRequest(request) {
		return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "invalid_key_wrap_migration"})
	}
	replacement, err := httpapi.DecodeBoundedBase64(request.ReplacementCiphertext, 29, sharedapp.MaxEncryptedPayloadBytes)
	if err != nil {
		return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "invalid_key_wrap_migration"})
	}
	defer clear(replacement)
	result, err := handlers.access.MigrateKeyWrap(
		ctx.Request().Context(), userID, ctx.Param("vaultId"), int64(request.ExpectedKeyVersion),
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
	switch result {
	case sharedapp.EncryptedPayloadMigrationCommitted, sharedapp.EncryptedPayloadMigrationAlreadyCommitted:
		return ctx.NoContent(http.StatusNoContent)
	case sharedapp.EncryptedPayloadMigrationConflict:
		return ctx.JSON(http.StatusConflict, httpapi.ApiError{Error: "key_wrap_migration_conflict"})
	default:
		return errors.New("Shared Vault key-wrap migration returned an unsupported result")
	}
}

func (handlers *SharedVaultAccessHandlers) authorizeMutation(ctx *echo.Context) (string, bool, error) {
	if handlers.authorizer == nil {
		return "", false, errors.New("application request authorizer is not configured")
	}
	userID, authorized, err := handlers.authorizer.AuthorizeApplicationRequest(ctx, "key_material_mutation")
	if err != nil || !authorized {
		return "", authorized, err
	}
	if userID == "" {
		return "", false, errors.New("application request authorizer returned an empty user ID")
	}
	return userID, true, nil
}

func validSharedVaultKeyWrapMigrationRequest(request sharedVaultKeyWrapMigrationRequest) bool {
	return request.ExpectedEnvelopeVersion == 1 && request.ReplacementEnvelopeVersion == 2 &&
		sharedapp.HasSHA256Base64URLDigestShape(request.ExpectedCiphertextDigest) &&
		sharedapp.HasSHA256Base64URLDigestShape(request.ReplacementCiphertextDigest) &&
		request.OperationID == request.ReplacementCiphertextDigest && request.ExpectedKeyVersion > 0
}
