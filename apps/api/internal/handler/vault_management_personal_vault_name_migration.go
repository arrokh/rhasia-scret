package handler

import (
	"errors"
	"net/http"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

type personalVaultNameMigrationRequest struct {
	VaultID                     string                      `json:"vaultId"`
	ExpectedKeyVersion          httpapi.PositiveSafeInteger `json:"expectedKeyVersion"`
	ExpectedEnvelopeVersion     int                         `json:"expectedEnvelopeVersion"`
	ReplacementEnvelopeVersion  int                         `json:"replacementEnvelopeVersion"`
	ExpectedCiphertextDigest    string                      `json:"expectedCiphertextDigest"`
	ReplacementCiphertextDigest string                      `json:"replacementCiphertextDigest"`
	ReplacementCiphertext       string                      `json:"replacementCiphertext"`
	OperationID                 string                      `json:"operationId"`
}

func (handlers *VaultManagementHandlers) migratePersonalVaultName(ctx *echo.Context) error {
	if handlers.dependencies.Authorizer == nil {
		return errors.New("application request authorizer is unavailable")
	}
	ownerID, authorized, err := handlers.dependencies.Authorizer.AuthorizeApplicationRequest(ctx, "vault_mutation")
	if err != nil || !authorized {
		return err
	}
	if handlers.dependencies.PersonalVaults == nil {
		return errors.New("Personal Vault repository is unavailable")
	}
	request, err := httpapi.DecodeJSONBody[personalVaultNameMigrationRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || !validPersonalVaultNameMigrationRequest(request) {
		return writePersonalVaultError(ctx, http.StatusBadRequest, "invalid_vault_name_migration")
	}
	replacement, err := httpapi.DecodeBoundedBase64(request.ReplacementCiphertext, 29, sharedapp.MaxEncryptedPayloadBytes)
	if err != nil {
		return writePersonalVaultError(ctx, http.StatusBadRequest, "invalid_vault_name_migration")
	}
	migration := sharedapp.EncryptedPayloadMigration{
		ExpectedEnvelopeVersion:     request.ExpectedEnvelopeVersion,
		ReplacementEnvelopeVersion:  request.ReplacementEnvelopeVersion,
		ExpectedCiphertextDigest:    request.ExpectedCiphertextDigest,
		ReplacementCiphertextDigest: request.ReplacementCiphertextDigest,
		ReplacementCiphertext:       replacement,
		OperationID:                 request.OperationID,
	}
	defer clear(migration.ReplacementCiphertext)
	result, err := handlers.dependencies.PersonalVaults.MigrateName(
		ctx.Request().Context(), ownerID, request.VaultID, int64(request.ExpectedKeyVersion), migration,
	)
	if err != nil {
		return err
	}
	switch result {
	case sharedapp.EncryptedPayloadMigrationCommitted, sharedapp.EncryptedPayloadMigrationAlreadyCommitted:
		return ctx.NoContent(http.StatusNoContent)
	case sharedapp.EncryptedPayloadMigrationConflict:
		return writePersonalVaultError(ctx, http.StatusConflict, "personal_vault_name_migration_conflict")
	default:
		return errors.New("Personal Vault name migration returned an unsupported result")
	}
}

func validPersonalVaultNameMigrationRequest(request personalVaultNameMigrationRequest) bool {
	return httpapi.ValidRouteParameter(request.VaultID) &&
		request.ExpectedKeyVersion > 0 &&
		request.ExpectedEnvelopeVersion == 1 && request.ReplacementEnvelopeVersion == 2 &&
		sharedapp.HasSHA256Base64URLDigestShape(request.ExpectedCiphertextDigest) &&
		sharedapp.HasSHA256Base64URLDigestShape(request.ReplacementCiphertextDigest) &&
		request.OperationID == request.ReplacementCiphertextDigest
}
