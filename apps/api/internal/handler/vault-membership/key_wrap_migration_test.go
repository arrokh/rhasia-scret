package http

import (
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

func TestMigrateSharedVaultKeyWrapRequiresKeyMaterialAuthorizationAndClearsReplacement(t *testing.T) {
	replacement := syntheticKeyWrapEnvelope()
	oldCiphertext := []byte{1, 3, 5, 7, 9}
	replacementDigest := application.SHA256Base64URL(replacement)
	body := `{"expectedEnvelopeVersion":1.0,"replacementEnvelopeVersion":2.0,"expectedCiphertextDigest":"` +
		application.SHA256Base64URL(oldCiphertext) + `","replacementCiphertextDigest":"` + replacementDigest +
		`","replacementCiphertext":"` + base64.StdEncoding.EncodeToString(replacement) + `","operationId":"` +
		replacementDigest + `","expectedKeyVersion":2.0}`
	authorizer := &sharedVaultAccessAuthorizerStub{userID: "synthetic-viewer", authorized: true}
	repository := &sharedVaultAccessRepositoryStub{migrationResult: application.EncryptedPayloadMigrationCommitted}
	handler := NewSharedVaultAccessHandlers(authorizer, repository).OperationHandlers()["postSharedvaultsVaultIdKeywrapMigration"]
	request := httptest.NewRequest(http.MethodPost, "/v1/shared-vaults/synthetic-vault/key-wrap/migration", strings.NewReader(body))
	response := httptest.NewRecorder()
	context := echo.New().NewContext(request, response)
	context.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}})
	if err := handler(context); err != nil {
		t.Fatalf("Shared Vault key-wrap migration: %v", err)
	}
	if response.Code != http.StatusNoContent || response.Body.Len() != 0 || authorizer.calls != 1 || authorizer.mutation != "key_material_mutation" ||
		repository.migrationCalls != 1 || repository.migrationUser != "synthetic-viewer" || repository.migrationVault != "synthetic-vault" || repository.migrationVersion != 2 {
		t.Fatalf("Shared Vault key-wrap migration response=%d %s auth=%#v repository=%#v", response.Code, response.Body.String(), authorizer, repository)
	}
	if string(repository.migration.ReplacementCiphertext) != string(replacement) || repository.migration.ExpectedEnvelopeVersion != 1 ||
		repository.migration.ReplacementEnvelopeVersion != 2 || repository.migration.ReplacementCiphertextDigest != replacementDigest ||
		!sharedAccessBytesZero(repository.migrationBuffer) {
		t.Fatal("Shared Vault key-wrap migration did not preserve or clear expected bytes")
	}
}

func TestMigrateSharedVaultKeyWrapMapsConflictAndRejectsMalformedMigration(t *testing.T) {
	replacement := syntheticKeyWrapEnvelope()
	digest := application.SHA256Base64URL(replacement)
	body := `{"expectedEnvelopeVersion":1,"replacementEnvelopeVersion":2,"expectedCiphertextDigest":"` + digest +
		`","replacementCiphertextDigest":"` + digest + `","replacementCiphertext":"` + base64.StdEncoding.EncodeToString(replacement) +
		`","operationId":"` + digest + `","expectedKeyVersion":1}`
	authorizer := &sharedVaultAccessAuthorizerStub{userID: "synthetic-owner", authorized: true}
	repository := &sharedVaultAccessRepositoryStub{migrationResult: application.EncryptedPayloadMigrationConflict}
	handler := NewSharedVaultAccessHandlers(authorizer, repository).OperationHandlers()["postSharedvaultsVaultIdKeywrapMigration"]
	request := httptest.NewRequest(http.MethodPost, "/v1/shared-vaults/synthetic-vault/key-wrap/migration", strings.NewReader(body))
	response := httptest.NewRecorder()
	context := echo.New().NewContext(request, response)
	context.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}})
	if err := handler(context); err != nil {
		t.Fatalf("Shared Vault key-wrap conflict: %v", err)
	}
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "key_wrap_migration_conflict") {
		t.Fatalf("key-wrap conflict response=%d %s", response.Code, response.Body.String())
	}

	invalidBody := strings.Replace(body, `"operationId":"`+digest+`"`, `"operationId":"`+strings.Repeat("A", 43)+`"`, 1)
	request = httptest.NewRequest(http.MethodPost, "/v1/shared-vaults/synthetic-vault/key-wrap/migration", strings.NewReader(invalidBody))
	response = httptest.NewRecorder()
	context = echo.New().NewContext(request, response)
	context.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}})
	if err := handler(context); err != nil {
		t.Fatalf("invalid key-wrap migration: %v", err)
	}
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "invalid_key_wrap_migration") || repository.migrationCalls != 1 {
		t.Fatalf("invalid key-wrap migration response=%d %s; repository calls=%d", response.Code, response.Body.String(), repository.migrationCalls)
	}
}

func TestMigrateSharedVaultKeyWrapStopsOnAuthenticationAndPropagatesErrors(t *testing.T) {
	authorizer := &sharedVaultAccessAuthorizerStub{authorized: false}
	repository := &sharedVaultAccessRepositoryStub{}
	handler := NewSharedVaultAccessHandlers(authorizer, repository).OperationHandlers()["postSharedvaultsVaultIdKeywrapMigration"]
	request := httptest.NewRequest(http.MethodPost, "/v1/shared-vaults/synthetic-vault/key-wrap/migration", strings.NewReader("not-json"))
	response := httptest.NewRecorder()
	context := echo.New().NewContext(request, response)
	context.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}})
	if err := handler(context); err != nil {
		t.Fatalf("unauthorized key-wrap migration: %v", err)
	}
	if response.Code != http.StatusUnauthorized || repository.migrationCalls != 0 {
		t.Fatalf("unauthorized key-wrap migration response=%d calls=%d", response.Code, repository.migrationCalls)
	}

	authorizer.authorized = true
	authorizer.userID = "synthetic-viewer"
	repository.migrationErr = errors.New("synthetic repository failure")
	replacement := syntheticKeyWrapEnvelope()
	digest := application.SHA256Base64URL(replacement)
	body := `{"expectedEnvelopeVersion":1,"replacementEnvelopeVersion":2,"expectedCiphertextDigest":"` + digest +
		`","replacementCiphertextDigest":"` + digest + `","replacementCiphertext":"` + base64.StdEncoding.EncodeToString(replacement) +
		`","operationId":"` + digest + `","expectedKeyVersion":1}`
	request = httptest.NewRequest(http.MethodPost, "/v1/shared-vaults/synthetic-vault/key-wrap/migration", strings.NewReader(body))
	response = httptest.NewRecorder()
	context = echo.New().NewContext(request, response)
	context.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}})
	if err := handler(context); !errors.Is(err, repository.migrationErr) {
		t.Fatalf("repository error=%v; want propagation to generic error mapper", err)
	}
	if response.Body.Len() != 0 {
		t.Fatalf("repository failure was mapped locally: %s", response.Body.String())
	}
}

func syntheticKeyWrapEnvelope() []byte {
	return []byte(`{"version":2,"ciphertext":"` + strings.Repeat("A", 64) + `","nonce":"` + strings.Repeat("B", 16) +
		`","ephemeralPublicKey":{"kty":"EC","crv":"P-256","x":"` + strings.Repeat("C", 43) + `","y":"` +
		strings.Repeat("D", 43) + `"}}`)
}
