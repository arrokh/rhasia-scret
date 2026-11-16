package handler

import (
	"errors"
	"net/http"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

type sharedVaultNameMigrationRequest struct {
	ExpectedEnvelopeVersion     httpapi.PositiveSafeInteger `json:"expectedEnvelopeVersion"`
	ReplacementEnvelopeVersion  httpapi.PositiveSafeInteger `json:"replacementEnvelopeVersion"`
	ExpectedCiphertextDigest    string                      `json:"expectedCiphertextDigest"`
	ReplacementCiphertextDigest string                      `json:"replacementCiphertextDigest"`
	ReplacementCiphertext       string                      `json:"replacementCiphertext"`
	OperationID                 string                      `json:"operationId"`
	ExpectedKeyVersion          httpapi.PositiveSafeInteger `json:"expectedKeyVersion"`
}

func (handlers *VaultManagementHandlers) migrateSharedVaultName(ctx *echo.Context) error {
	if handlers.dependencies.Authorizer == nil {
		return errors.New("application request authorizer is unavailable")
	}
	actorID, authorized, err := handlers.dependencies.Authorizer.AuthorizeApplicationRequest(ctx, "vault_mutation")
	if err != nil || !authorized {
		return err
	}
	if handlers.dependencies.SharedVaults == nil {
		return errors.New("Shared Vault repository is unavailable")
	}
	request, err := httpapi.DecodeJSONBody[sharedVaultNameMigrationRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || !validSharedVaultNameMigrationRequest(request) {
		return writePersonalVaultError(ctx, http.StatusBadRequest, "invalid_vault_name_migration")
	}
	replacement, err := httpapi.DecodeBoundedBase64(request.ReplacementCiphertext, 29, sharedapp.MaxEncryptedPayloadBytes)
	if err != nil {
		return writePersonalVaultError(ctx, http.StatusBadRequest, "invalid_vault_name_migration")
	}
	defer clear(replacement)
	result, err := handlers.dependencies.SharedVaults.MigrateName(
		ctx.Request().Context(), actorID, ctx.Param("vaultId"), int64(request.ExpectedKeyVersion),
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
		return writePersonalVaultError(ctx, http.StatusConflict, "vault_name_migration_conflict")
	default:
		return errors.New("Shared Vault name migration returned an unsupported result")
	}
}

func validSharedVaultNameMigrationRequest(request sharedVaultNameMigrationRequest) bool {
	return request.ExpectedEnvelopeVersion == 1 && request.ReplacementEnvelopeVersion == 2 &&
		sharedapp.HasSHA256Base64URLDigestShape(request.ExpectedCiphertextDigest) &&
		sharedapp.HasSHA256Base64URLDigestShape(request.ReplacementCiphertextDigest) &&
		request.OperationID == request.ReplacementCiphertextDigest && request.ExpectedKeyVersion > 0
}
