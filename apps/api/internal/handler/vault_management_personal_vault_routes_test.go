package handler

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"

	apiEntity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

type personalVaultRepositoryStub struct {
	ensureCalls int
	ownerID     string
	vault       apiEntity.Vault
	ensureErr   error

	migrationCalls  int
	migrationOwner  string
	migrationVault  string
	keyVersion      int64
	migration       sharedapp.EncryptedPayloadMigration
	migrationCopy   []byte
	migrationResult sharedapp.EncryptedPayloadMigrationResult
	migrationErr    error
}

func (repository *personalVaultRepositoryStub) EnsureForOwner(_ context.Context, ownerID string) (apiEntity.Vault, error) {
	repository.ensureCalls++
	repository.ownerID = ownerID
	return repository.vault, repository.ensureErr
}

func (repository *personalVaultRepositoryStub) MigrateName(_ context.Context, ownerID string, vaultID string, keyVersion int64, migration sharedapp.EncryptedPayloadMigration) (sharedapp.EncryptedPayloadMigrationResult, error) {
	repository.migrationCalls++
	repository.migrationOwner = ownerID
	repository.migrationVault = vaultID
	repository.keyVersion = keyVersion
	repository.migrationCopy = append([]byte(nil), migration.ReplacementCiphertext...)
	repository.migration = migration
	return repository.migrationResult, repository.migrationErr
}

func TestGetPersonalVaultReturnsOnlyGenericLifecycleMetadata(t *testing.T) {
	vault, err := apiEntity.NewVault("synthetic-personal-vault", apiEntity.VaultTypePersonal, "synthetic-owner", apiEntity.VaultLifecycleUninitialized)
	if err != nil {
		t.Fatal(err)
	}
	authorizer := &personalVaultAuthorizerStub{ownerID: "synthetic-owner", authorized: true}
	repository := &personalVaultRepositoryStub{vault: vault}
	handler := NewVaultManagementHandlers(VaultManagementDependencies{Authorizer: authorizer, PersonalVaults: repository}).OperationHandlers()["getPersonalvault"]
	response := invokePersonalVaultGetHandler(t, handler)
	if response.Code != http.StatusOK {
		t.Fatalf("Personal Vault read response=%d %s", response.Code, response.Body.String())
	}
	var result map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode Personal Vault response: %v", err)
	}
	if len(result) != 2 || result["id"] != vault.ID || result["lifecycle"] != string(apiEntity.VaultLifecycleUninitialized) {
		t.Fatalf("Personal Vault response disclosed unexpected fields: %#v", result)
	}
	if authorizer.calls != 1 || authorizer.mutation != "" || repository.ensureCalls != 1 || repository.ownerID != "synthetic-owner" {
		t.Fatalf("Personal Vault read did not authenticate before ensuring: auth=%#v repository=%#v", authorizer, repository)
	}
}

func TestGetPersonalVaultRejectsUnauthorizedCallerBeforeEnsure(t *testing.T) {
	authorizer := &personalVaultAuthorizerStub{authorized: false}
	repository := &personalVaultRepositoryStub{}
	handler := NewVaultManagementHandlers(VaultManagementDependencies{Authorizer: authorizer, PersonalVaults: repository}).OperationHandlers()["getPersonalvault"]
	response := invokePersonalVaultGetHandler(t, handler)
	if response.Code != http.StatusUnauthorized || repository.ensureCalls != 0 || authorizer.mutation != "" {
		t.Fatalf("unauthorized Personal Vault read response=%d ensures=%d mutation=%q", response.Code, repository.ensureCalls, authorizer.mutation)
	}
}

func TestPersonalVaultNameMigrationClearsReplacementBuffer(t *testing.T) {
	requestBody, expectedCiphertext, replacementCiphertext := syntheticPersonalVaultNameMigrationRequest()
	authorizer := &personalVaultAuthorizerStub{ownerID: "synthetic-owner", authorized: true}
	repository := &personalVaultRepositoryStub{migrationResult: sharedapp.EncryptedPayloadMigrationCommitted}
	handler := NewVaultManagementHandlers(VaultManagementDependencies{Authorizer: authorizer, PersonalVaults: repository}).OperationHandlers()["postPersonalvaultNameMigration"]
	response := invokePersonalVaultMigrationHandler(t, handler, requestBody)
	if response.Code != http.StatusNoContent || response.Body.Len() != 0 {
		t.Fatalf("name migration response=%d %q", response.Code, response.Body.String())
	}
	if authorizer.calls != 1 || authorizer.mutation != "vault_mutation" || repository.migrationCalls != 1 ||
		repository.migrationOwner != "synthetic-owner" || repository.migrationVault != "synthetic-vault" || repository.keyVersion != 3 {
		t.Fatalf("name migration did not authorize and invoke repository: auth=%#v repository=%#v", authorizer, repository)
	}
	if repository.migration.ExpectedEnvelopeVersion != 1 || repository.migration.ReplacementEnvelopeVersion != 2 ||
		repository.migration.ExpectedCiphertextDigest != sharedapp.SHA256Base64URL(expectedCiphertext) ||
		repository.migration.ReplacementCiphertextDigest != sharedapp.SHA256Base64URL(replacementCiphertext) ||
		repository.migration.OperationID != repository.migration.ReplacementCiphertextDigest ||
		string(repository.migrationCopy) != string(replacementCiphertext) {
		t.Fatal("repository received unexpected encrypted name migration values")
	}
	if !allPersonalVaultBytesZero(repository.migration.ReplacementCiphertext) {
		t.Fatal("request-owned replacement ciphertext buffer was not cleared")
	}
}

func TestPersonalVaultNameMigrationMapsConflictAndRejectsInvalidRequest(t *testing.T) {
	body, _, _ := syntheticPersonalVaultNameMigrationRequest()
	authorizer := &personalVaultAuthorizerStub{ownerID: "synthetic-owner", authorized: true}
	repository := &personalVaultRepositoryStub{migrationResult: sharedapp.EncryptedPayloadMigrationConflict}
	handler := NewVaultManagementHandlers(VaultManagementDependencies{Authorizer: authorizer, PersonalVaults: repository}).OperationHandlers()["postPersonalvaultNameMigration"]
	conflict := invokePersonalVaultMigrationHandler(t, handler, body)
	if conflict.Code != http.StatusConflict || !strings.Contains(conflict.Body.String(), "personal_vault_name_migration_conflict") {
		t.Fatalf("name migration conflict response=%d %s", conflict.Code, conflict.Body.String())
	}
	invalid := []string{
		strings.Replace(body, `"replacementEnvelopeVersion":2`, `"replacementEnvelopeVersion":1`, 1),
		strings.Replace(body, `"expectedKeyVersion":3`, `"expectedKeyVersion":0`, 1),
		strings.Replace(body, `"operationId":"`, `"operationId":"X`, 1),
		strings.TrimSuffix(body, "}") + `,"plaintext":"forbidden"}`,
		strings.Replace(body, `"replacementCiphertext":"`, `"replacementCiphertext":"?`, 1),
	}
	callsBefore := repository.migrationCalls
	for _, value := range invalid {
		response := invokePersonalVaultMigrationHandler(t, handler, value)
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "invalid_vault_name_migration") {
			t.Errorf("invalid name migration response=%d %s", response.Code, response.Body.String())
		}
	}
	if repository.migrationCalls != callsBefore {
		t.Fatalf("invalid name migrations reached persistence %d times", repository.migrationCalls-callsBefore)
	}
}

func TestPersonalVaultNameMigrationRejectsUnauthorizedCallerBeforeParsing(t *testing.T) {
	authorizer := &personalVaultAuthorizerStub{authorized: false}
	repository := &personalVaultRepositoryStub{}
	handler := NewVaultManagementHandlers(VaultManagementDependencies{Authorizer: authorizer, PersonalVaults: repository}).OperationHandlers()["postPersonalvaultNameMigration"]
	response := invokePersonalVaultMigrationHandler(t, handler, "not-json")
	if response.Code != http.StatusUnauthorized || repository.migrationCalls != 0 || authorizer.mutation != "vault_mutation" {
		t.Fatalf("unauthorized migration response=%d calls=%d mutation=%q", response.Code, repository.migrationCalls, authorizer.mutation)
	}
}

func syntheticPersonalVaultNameMigrationRequest() (string, []byte, []byte) {
	expected := personalVaultEnvelope(1, 64)
	replacement := personalVaultEnvelope(2, 65)
	body, _ := json.Marshal(map[string]any{
		"vaultId":                     "synthetic-vault",
		"expectedKeyVersion":          3,
		"expectedEnvelopeVersion":     1,
		"replacementEnvelopeVersion":  2,
		"expectedCiphertextDigest":    sharedapp.SHA256Base64URL(expected),
		"replacementCiphertextDigest": sharedapp.SHA256Base64URL(replacement),
		"replacementCiphertext":       base64.StdEncoding.EncodeToString(replacement),
		"operationId":                 sharedapp.SHA256Base64URL(replacement),
	})
	return string(body), expected, replacement
}

func invokePersonalVaultGetHandler(t *testing.T, handler httpapi.OperationHandler) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/v1/personal-vault", nil)
	response := httptest.NewRecorder()
	ctx := echo.New().NewContext(request, response)
	if err := handler(ctx); err != nil {
		t.Fatalf("Personal Vault GET handler returned error: %v", err)
	}
	return response
}

func invokePersonalVaultMigrationHandler(t *testing.T, handler httpapi.OperationHandler, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/v1/personal-vault/name/migration", strings.NewReader(body))
	response := httptest.NewRecorder()
	ctx := echo.New().NewContext(request, response)
	if err := handler(ctx); err != nil {
		t.Fatalf("Personal Vault migration handler returned error: %v", err)
	}
	return response
}
