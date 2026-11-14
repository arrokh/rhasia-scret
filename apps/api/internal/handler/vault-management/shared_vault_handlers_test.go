package http

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"

	vaultdomain "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity/vault-management"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	vaultapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/vault-management"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

type sharedVaultRepositoryStub struct {
	createCalls   int
	createOwner   string
	createInput   vaultapp.NewSharedVault
	createBuffers [][]byte
	created       vaultdomain.Vault
	createErr     error

	renameCalls        int
	renameOwner        string
	renameVault        string
	renameName         []byte
	renameBuffer       []byte
	renameVersion      int
	expectedKeyVersion int64
	renameErr          error
	renamed            bool

	migrationCalls  int
	migrationActor  string
	migrationVault  string
	migration       sharedapp.EncryptedPayloadMigration
	migrationBuffer []byte
	migrationResult sharedapp.EncryptedPayloadMigrationResult
	migrationErr    error
}

func (repository *sharedVaultRepositoryStub) Create(_ context.Context, ownerID string, input vaultapp.NewSharedVault) (vaultdomain.Vault, error) {
	repository.createCalls++
	repository.createOwner = ownerID
	repository.createBuffers = [][]byte{input.EncryptedName, input.EncryptedOwnerVaultKey}
	repository.createInput = vaultapp.NewSharedVault{
		ID:                     input.ID,
		EncryptedName:          append([]byte(nil), input.EncryptedName...),
		EncryptedOwnerVaultKey: append([]byte(nil), input.EncryptedOwnerVaultKey...),
		ExpectedOwnerPublicKey: input.ExpectedOwnerPublicKey,
		EncryptionVersion:      input.EncryptionVersion,
	}
	return repository.created, repository.createErr
}

func (repository *sharedVaultRepositoryStub) Rename(_ context.Context, ownerID string, vaultID string, encryptedName []byte, encryptionVersion int, expectedKeyVersion int64) (bool, error) {
	repository.renameCalls++
	repository.renameOwner = ownerID
	repository.renameVault = vaultID
	repository.renameBuffer = encryptedName
	repository.renameName = append([]byte(nil), encryptedName...)
	repository.renameVersion = encryptionVersion
	repository.expectedKeyVersion = expectedKeyVersion
	return repository.renamed, repository.renameErr
}

func (repository *sharedVaultRepositoryStub) MigrateName(_ context.Context, actorID string, vaultID string, keyVersion int64, migration sharedapp.EncryptedPayloadMigration) (sharedapp.EncryptedPayloadMigrationResult, error) {
	repository.migrationCalls++
	repository.migrationActor = actorID
	repository.migrationVault = vaultID
	repository.expectedKeyVersion = keyVersion
	repository.migrationBuffer = migration.ReplacementCiphertext
	repository.migration = migration
	repository.migration.ReplacementCiphertext = append([]byte(nil), migration.ReplacementCiphertext...)
	return repository.migrationResult, repository.migrationErr
}

func TestCreateSharedVaultValidatesAuthorizesAndClearsCiphertextBuffers(t *testing.T) {
	name := personalVaultEnvelope(1, 13)
	ownerKey := personalVaultEnvelope(2, 17)
	body := `{"vaultId":"synthetic-shared-vault-01","encryptedName":"` + base64String(name) +
		`","encryptedOwnerVaultKey":"` + base64String(ownerKey) + `","expectedOwnerPublicKey":` +
		personalVaultPublicKeyJSON("A") + `,"encryptionVersion":1.0}`
	authorizer := &personalVaultAuthorizerStub{ownerID: "synthetic-owner", authorized: true}
	repository := &sharedVaultRepositoryStub{created: vaultdomain.Vault{ID: "synthetic-shared-vault-01"}}
	handlers := NewHandlers(Dependencies{Authorizer: authorizer, SharedVaults: repository}).OperationHandlers()
	response := invokeSharedVaultHandler(t, handlers["postSharedvaults"], http.MethodPost, "/v1/shared-vaults", body, "")
	if response.Code != http.StatusCreated || !strings.Contains(response.Body.String(), `"id":"synthetic-shared-vault-01"`) ||
		authorizer.calls != 1 || authorizer.mutation != "vault_mutation" || repository.createCalls != 1 ||
		repository.createOwner != "synthetic-owner" {
		t.Fatalf("Shared Vault create response=%d %s auth=%#v repository=%#v", response.Code, response.Body.String(), authorizer, repository)
	}
	if repository.createInput.ID != "synthetic-shared-vault-01" || string(repository.createInput.EncryptedName) != string(name) ||
		string(repository.createInput.EncryptedOwnerVaultKey) != string(ownerKey) || repository.createInput.EncryptionVersion != 1 ||
		repository.createInput.ExpectedOwnerPublicKey.X != strings.Repeat("A", 43) || repository.createInput.ExpectedOwnerPublicKey.KeyOps == nil {
		t.Fatalf("Shared Vault repository received unexpected input: %#v", repository.createInput)
	}
	for _, buffer := range repository.createBuffers {
		if !allPersonalVaultBytesZero(buffer) {
			t.Fatal("Shared Vault creation ciphertext buffer was not cleared after repository call")
		}
	}
}

func TestCreateSharedVaultAllowsOmittedIDAndMapsIdentityConflict(t *testing.T) {
	ciphertext := base64String(personalVaultEnvelope(1, 13))
	body := `{"encryptedName":"` + ciphertext + `","encryptedOwnerVaultKey":"` + ciphertext +
		`","expectedOwnerPublicKey":` + personalVaultPublicKeyJSON("A") + `,"encryptionVersion":1}`
	authorizer := &personalVaultAuthorizerStub{ownerID: "synthetic-owner", authorized: true}
	repository := &sharedVaultRepositoryStub{createErr: vaultapp.ErrSharedVaultIdentityConflict}
	handler := NewHandlers(Dependencies{Authorizer: authorizer, SharedVaults: repository}).OperationHandlers()["postSharedvaults"]
	response := invokeSharedVaultHandler(t, handler, http.MethodPost, "/v1/shared-vaults", body, "")
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "stale_user_encryption_identity") || repository.createCalls != 1 || repository.createInput.ID != "" {
		t.Fatalf("identity conflict response=%d %s repository=%#v", response.Code, response.Body.String(), repository)
	}
}

func TestCreateSharedVaultRejectsMalformedPayloadsBeforeRepository(t *testing.T) {
	ciphertext := base64String(personalVaultEnvelope(1, 13))
	valid := `{"vaultId":"synthetic-shared-vault-01","encryptedName":"` + ciphertext + `","encryptedOwnerVaultKey":"` + ciphertext +
		`","expectedOwnerPublicKey":` + personalVaultPublicKeyJSON("A") + `,"encryptionVersion":1}`
	cases := []string{
		strings.Replace(valid, `"vaultId":"synthetic-shared-vault-01"`, `"vaultId":null`, 1),
		strings.Replace(valid, `"vaultId":"synthetic-shared-vault-01"`, `"vaultId":"short"`, 1),
		strings.Replace(valid, `"encryptedName":"`+ciphertext+`"`, `"encryptedName":"%%%"`, 1),
		strings.Replace(valid, `"encryptionVersion":1`, `"encryptionVersion":2`, 1),
		strings.Replace(valid, `"expectedOwnerPublicKey":`+personalVaultPublicKeyJSON("A"), `"expectedOwnerPublicKey":{"kty":"EC"}`, 1),
		strings.TrimSuffix(valid, "}") + `,"extra":true}`,
		`null`,
	}
	authorizer := &personalVaultAuthorizerStub{ownerID: "synthetic-owner", authorized: true}
	repository := &sharedVaultRepositoryStub{}
	handler := NewHandlers(Dependencies{Authorizer: authorizer, SharedVaults: repository}).OperationHandlers()["postSharedvaults"]
	for _, body := range cases {
		response := invokeSharedVaultHandler(t, handler, http.MethodPost, "/v1/shared-vaults", body, "")
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "invalid_vault") {
			t.Errorf("invalid Shared Vault create response=%d %s", response.Code, response.Body.String())
		}
	}
	if repository.createCalls != 0 {
		t.Fatalf("invalid Shared Vault creation reached repository %d times", repository.createCalls)
	}
}

func TestRenameSharedVaultMapsAuthorizationConflictAndMissingOwnerAccess(t *testing.T) {
	ciphertext := base64String(personalVaultEnvelope(2, 13))
	body := `{"encryptedName":"` + ciphertext + `","encryptionVersion":1.0,"expectedKeyVersion":2.0}`
	authorizer := &personalVaultAuthorizerStub{ownerID: "synthetic-owner", authorized: true}
	repository := &sharedVaultRepositoryStub{renamed: true}
	handler := NewHandlers(Dependencies{Authorizer: authorizer, SharedVaults: repository}).OperationHandlers()["patchSharedvaultsVaultId"]
	response := invokeSharedVaultHandler(t, handler, http.MethodPatch, "/v1/shared-vaults/synthetic-vault", body, "synthetic-vault")
	if response.Code != http.StatusNoContent || response.Body.Len() != 0 || authorizer.mutation != "vault_mutation" ||
		repository.renameCalls != 1 || repository.renameOwner != "synthetic-owner" || repository.renameVault != "synthetic-vault" ||
		string(repository.renameName) != string(personalVaultEnvelope(2, 13)) || repository.renameVersion != 1 || repository.expectedKeyVersion != 2 {
		t.Fatalf("Shared Vault rename response=%d %s auth=%#v repository=%#v", response.Code, response.Body.String(), authorizer, repository)
	}
	if !allPersonalVaultBytesZero(repository.renameBuffer) {
		t.Fatal("Shared Vault rename ciphertext buffer was not cleared after repository call")
	}

	repository.renamed = false
	response = invokeSharedVaultHandler(t, handler, http.MethodPatch, "/v1/shared-vaults/synthetic-vault", body, "synthetic-vault")
	if response.Code != http.StatusNotFound || !strings.Contains(response.Body.String(), "owner_access_required") {
		t.Fatalf("missing owner access response=%d %s", response.Code, response.Body.String())
	}
	repository.renameErr = vaultapp.ErrSharedVaultKeyVersionConflict
	response = invokeSharedVaultHandler(t, handler, http.MethodPatch, "/v1/shared-vaults/synthetic-vault", body, "synthetic-vault")
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "stale_key_version") {
		t.Fatalf("stale key response=%d %s", response.Code, response.Body.String())
	}
}

func TestSharedVaultMutationsAuthorizeBeforeBodyAndPropagateRepositoryErrors(t *testing.T) {
	authorizer := &personalVaultAuthorizerStub{authorized: false}
	repository := &sharedVaultRepositoryStub{}
	handlers := NewHandlers(Dependencies{Authorizer: authorizer, SharedVaults: repository}).OperationHandlers()
	response := invokeSharedVaultHandler(t, handlers["postSharedvaults"], http.MethodPost, "/v1/shared-vaults", "not-json", "")
	if response.Code != http.StatusUnauthorized || repository.createCalls != 0 {
		t.Fatalf("unauthorized create response=%d repository calls=%d", response.Code, repository.createCalls)
	}
	authorizer.authorized = true
	authorizer.ownerID = "synthetic-owner"
	repository.createErr = errors.New("synthetic database failure")
	ciphertext := base64String(personalVaultEnvelope(1, 13))
	body := `{"encryptedName":"` + ciphertext + `","encryptedOwnerVaultKey":"` + ciphertext +
		`","expectedOwnerPublicKey":` + personalVaultPublicKeyJSON("A") + `,"encryptionVersion":1}`
	request := httptest.NewRequest(http.MethodPost, "/v1/shared-vaults", strings.NewReader(body))
	response = httptest.NewRecorder()
	ctx := echo.New().NewContext(request, response)
	if err := handlers["postSharedvaults"](ctx); !errors.Is(err, repository.createErr) {
		t.Fatalf("repository error=%v; want propagation to generic HTTP mapper", err)
	}
	if response.Body.Len() != 0 {
		t.Fatalf("repository failure was mapped locally: %s", response.Body.String())
	}
}

func invokeSharedVaultHandler(t *testing.T, handler httpapi.OperationHandler, method string, path string, body string, vaultID string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	response := httptest.NewRecorder()
	ctx := echo.New().NewContext(request, response)
	if vaultID != "" {
		ctx.SetPathValues(echo.PathValues{{Name: "vaultId", Value: vaultID}})
	}
	if err := handler(ctx); err != nil {
		t.Fatalf("Shared Vault handler returned error: %v", err)
	}
	return response
}

func base64String(value []byte) string {
	return base64.StdEncoding.EncodeToString(value)
}
