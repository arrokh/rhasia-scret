package handler

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"

	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

func TestMigrateSharedVaultNameUsesFreshMutationAndClearsReplacement(t *testing.T) {
	replacement := personalVaultEnvelope(2, 29)
	oldCiphertext := []byte("synthetic-legacy-vault-name")
	replacementDigest := sharedapp.SHA256Base64URL(replacement)
	body := `{"expectedEnvelopeVersion":1.0,"replacementEnvelopeVersion":2.0,"expectedCiphertextDigest":"` +
		sharedapp.SHA256Base64URL(oldCiphertext) + `","replacementCiphertextDigest":"` + replacementDigest +
		`","replacementCiphertext":"` + base64String(replacement) + `","operationId":"` + replacementDigest +
		`","expectedKeyVersion":3.0}`
	authorizer := &personalVaultAuthorizerStub{ownerID: "synthetic-viewer", authorized: true}
	repository := &sharedVaultRepositoryStub{migrationResult: sharedapp.EncryptedPayloadMigrationAlreadyCommitted}
	operation := NewVaultManagementHandlers(VaultManagementDependencies{Authorizer: authorizer, SharedVaults: repository}).OperationHandlers()["postSharedvaultsVaultIdNameMigration"]
	request := httptest.NewRequest(http.MethodPost, "/v1/shared-vaults/synthetic-vault/name/migration", strings.NewReader(body))
	response := httptest.NewRecorder()
	ctx := echo.New().NewContext(request, response)
	ctx.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}})
	if err := operation(ctx); err != nil {
		t.Fatalf("Shared Vault name migration handler: %v", err)
	}
	if response.Code != http.StatusNoContent || response.Body.Len() != 0 || authorizer.calls != 1 || authorizer.mutation != "vault_mutation" ||
		repository.migrationCalls != 1 || repository.migrationActor != "synthetic-viewer" || repository.migrationVault != "synthetic-vault" || repository.expectedKeyVersion != 3 {
		t.Fatalf("Shared Vault name migration response=%d %s auth=%#v repository=%#v", response.Code, response.Body.String(), authorizer, repository)
	}
	migration := repository.migration
	if migration.ExpectedEnvelopeVersion != 1 || migration.ReplacementEnvelopeVersion != 2 ||
		migration.ExpectedCiphertextDigest != sharedapp.SHA256Base64URL(oldCiphertext) ||
		migration.ReplacementCiphertextDigest != replacementDigest || migration.OperationID != replacementDigest ||
		string(migration.ReplacementCiphertext) != string(replacement) || !allPersonalVaultBytesZero(repository.migrationBuffer) {
		t.Fatal("Shared Vault name migration was not mapped exactly or its request buffer was not cleared")
	}
}

func TestMigrateSharedVaultNameMapsConflictsAndRejectsInvalidInput(t *testing.T) {
	replacement := personalVaultEnvelope(2, 29)
	digest := sharedapp.SHA256Base64URL(replacement)
	body := `{"expectedEnvelopeVersion":1,"replacementEnvelopeVersion":2,"expectedCiphertextDigest":"` + digest +
		`","replacementCiphertextDigest":"` + digest + `","replacementCiphertext":"` + base64String(replacement) +
		`","operationId":"` + digest + `","expectedKeyVersion":1}`
	authorizer := &personalVaultAuthorizerStub{ownerID: "synthetic-viewer", authorized: true}
	repository := &sharedVaultRepositoryStub{migrationResult: sharedapp.EncryptedPayloadMigrationConflict}
	operation := NewVaultManagementHandlers(VaultManagementDependencies{Authorizer: authorizer, SharedVaults: repository}).OperationHandlers()["postSharedvaultsVaultIdNameMigration"]
	request := httptest.NewRequest(http.MethodPost, "/v1/shared-vaults/synthetic-vault/name/migration", strings.NewReader(body))
	response := httptest.NewRecorder()
	ctx := echo.New().NewContext(request, response)
	ctx.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}})
	if err := operation(ctx); err != nil {
		t.Fatalf("Shared Vault name migration conflict: %v", err)
	}
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "vault_name_migration_conflict") {
		t.Fatalf("Shared Vault name migration conflict response=%d %s", response.Code, response.Body.String())
	}

	invalidBody := strings.Replace(body, `"operationId":"`+digest+`"`, `"operationId":"`+strings.Repeat("A", 43)+`"`, 1)
	request = httptest.NewRequest(http.MethodPost, "/v1/shared-vaults/synthetic-vault/name/migration", strings.NewReader(invalidBody))
	response = httptest.NewRecorder()
	ctx = echo.New().NewContext(request, response)
	ctx.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}})
	if err := operation(ctx); err != nil {
		t.Fatalf("invalid Shared Vault name migration: %v", err)
	}
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "invalid_vault_name_migration") || repository.migrationCalls != 1 {
		t.Fatalf("invalid name migration response=%d %s; repository calls=%d", response.Code, response.Body.String(), repository.migrationCalls)
	}
}

func TestMigrateSharedVaultNameAuthorizesBeforeBodyAndPropagatesRepositoryErrors(t *testing.T) {
	authorizer := &personalVaultAuthorizerStub{authorized: false}
	repository := &sharedVaultRepositoryStub{}
	operation := NewVaultManagementHandlers(VaultManagementDependencies{Authorizer: authorizer, SharedVaults: repository}).OperationHandlers()["postSharedvaultsVaultIdNameMigration"]
	request := httptest.NewRequest(http.MethodPost, "/v1/shared-vaults/synthetic-vault/name/migration", strings.NewReader("not-json"))
	response := httptest.NewRecorder()
	ctx := echo.New().NewContext(request, response)
	ctx.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}})
	if err := operation(ctx); err != nil {
		t.Fatalf("unauthorized Shared Vault name migration: %v", err)
	}
	if response.Code != http.StatusUnauthorized || repository.migrationCalls != 0 {
		t.Fatalf("unauthorized name migration response=%d calls=%d", response.Code, repository.migrationCalls)
	}

	authorizer.authorized = true
	authorizer.ownerID = "synthetic-viewer"
	repository.migrationErr = errors.New("synthetic repository failure")
	replacement := personalVaultEnvelope(2, 29)
	digest := sharedapp.SHA256Base64URL(replacement)
	body := `{"expectedEnvelopeVersion":1,"replacementEnvelopeVersion":2,"expectedCiphertextDigest":"` + digest +
		`","replacementCiphertextDigest":"` + digest + `","replacementCiphertext":"` + base64String(replacement) +
		`","operationId":"` + digest + `","expectedKeyVersion":1}`
	request = httptest.NewRequest(http.MethodPost, "/v1/shared-vaults/synthetic-vault/name/migration", strings.NewReader(body))
	response = httptest.NewRecorder()
	ctx = echo.New().NewContext(request, response)
	ctx.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}})
	if err := operation(ctx); !errors.Is(err, repository.migrationErr) {
		t.Fatalf("repository error=%v; want propagation to generic mapper", err)
	}
	if response.Body.Len() != 0 {
		t.Fatalf("repository failure was mapped locally: %s", response.Body.String())
	}
}
