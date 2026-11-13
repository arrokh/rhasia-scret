package http

import (
	"errors"
	"net/http"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

type personalAccountMigrationRequest struct {
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

func (handlers *PersonalAccountHandlers) migratePayload(ctx *echo.Context) error {
	ownerID, authorized, err := handlers.authorize(ctx, "account_mutation")
	if err != nil {
		return writeAccountUnavailable(ctx)
	}
	if !authorized {
		return nil
	}
	if handlers.accounts == nil {
		return writeAccountUnavailable(ctx)
	}
	request, err := httpapi.DecodeJSONBody[personalAccountMigrationRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || !validPersonalAccountMigrationRequest(request) {
		return writeAccountError(ctx, http.StatusBadRequest, "invalid_account_migration")
	}
	replacement, err := httpapi.DecodeBoundedBase64(request.ReplacementCiphertext, 29, sharedapp.MaxEncryptedPayloadBytes)
	if err != nil {
		return writeAccountError(ctx, http.StatusBadRequest, "invalid_account_migration")
	}
	migration := sharedapp.EncryptedPayloadMigration{
		ExpectedEnvelopeVersion:     int(request.ExpectedEnvelopeVersion),
		ReplacementEnvelopeVersion:  int(request.ReplacementEnvelopeVersion),
		ExpectedCiphertextDigest:    request.ExpectedCiphertextDigest,
		ReplacementCiphertextDigest: request.ReplacementCiphertextDigest,
		ReplacementCiphertext:       replacement,
		OperationID:                 request.OperationID,
	}
	defer clear(migration.ReplacementCiphertext)
	result, err := handlers.accounts.MigratePayload(
		ctx.Request().Context(), ownerID, ctx.Param("vaultId"), request.AccountID,
		int64(request.ExpectedRevision), int64(request.ExpectedKeyVersion), migration,
	)
	if err != nil {
		return err
	}
	switch result {
	case sharedapp.EncryptedPayloadMigrationCommitted, sharedapp.EncryptedPayloadMigrationAlreadyCommitted:
		return ctx.NoContent(http.StatusNoContent)
	case sharedapp.EncryptedPayloadMigrationConflict:
		return writeAccountError(ctx, http.StatusConflict, "account_migration_conflict")
	default:
		return errors.New("Personal Account migration returned an unsupported result")
	}
}

func validPersonalAccountMigrationRequest(request personalAccountMigrationRequest) bool {
	return httpapi.ValidRouteParameter(request.AccountID) && request.ExpectedRevision > 0 && request.ExpectedKeyVersion > 0 &&
		request.ExpectedEnvelopeVersion == 1 && request.ReplacementEnvelopeVersion == 2 &&
		sharedapp.HasSHA256Base64URLDigestShape(request.ExpectedCiphertextDigest) &&
		sharedapp.HasSHA256Base64URLDigestShape(request.ReplacementCiphertextDigest) &&
		request.OperationID == request.ReplacementCiphertextDigest
}
