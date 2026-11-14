package http

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"

	accountdomain "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity/authenticator-account"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	accountapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/authenticator-account"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

type sharedAccountAuthorizerStub struct {
	userID        string
	authorized    bool
	mutation      string
	calls         int
	failureStatus int
}

func (authorizer *sharedAccountAuthorizerStub) AuthorizeApplicationRequest(ctx *echo.Context, mutation string) (string, bool, error) {
	authorizer.calls++
	authorizer.mutation = mutation
	if !authorizer.authorized {
		status := authorizer.failureStatus
		if status == 0 {
			status = http.StatusUnauthorized
		}
		return "", false, ctx.JSON(status, httpapi.ApiError{Error: "unauthenticated"})
	}
	return authorizer.userID, true, nil
}

type sharedAccountRepositoryStub struct {
	createCalls      int
	createActor      string
	createVault      string
	createPayload    []byte
	createSnapshot   []byte
	createVersion    int
	createKeyVersion int64
	createResult     accountapp.SharedAccountMutationResult
	createErr        error

	updateCalls      int
	updateActor      string
	updateVault      string
	updateID         string
	updateRevision   int64
	updatePayload    []byte
	updateSnapshot   []byte
	updateVersion    int
	updateKeyVersion int64
	updateResult     accountapp.SharedAccountMutationResult
	updateErr        error

	deleteCalls    int
	deleteActor    string
	deleteVault    string
	deleteID       string
	deleteRevision int64
	deleteResult   accountapp.SharedAccountMutationResult
	deleteErr      error

	restoreCalls  int
	restoreActor  string
	restoreVault  string
	restoreID     string
	restoreResult accountapp.SharedAccountMutationResult
	restoreErr    error

	migrationCalls  int
	migrationActor  string
	migrationVault  string
	migrationID     string
	migrationRev    int64
	migrationKey    int64
	migration       sharedapp.EncryptedPayloadMigration
	migrationBytes  []byte
	migrationResult sharedapp.EncryptedPayloadMigrationResult
	migrationErr    error
}

func (repository *sharedAccountRepositoryStub) Create(_ context.Context, actorUserID string, vaultID string, payload []byte, encryptionVersion int, expectedKeyVersion int64) (accountapp.SharedAccountMutationResult, error) {
	repository.createCalls++
	repository.createActor = actorUserID
	repository.createVault = vaultID
	repository.createPayload = payload
	repository.createSnapshot = append([]byte(nil), payload...)
	repository.createVersion = encryptionVersion
	repository.createKeyVersion = expectedKeyVersion
	return repository.createResult, repository.createErr
}

func (repository *sharedAccountRepositoryStub) MigratePayload(_ context.Context, actorUserID string, vaultID string, accountID string, expectedRevision int64, expectedKeyVersion int64, migration sharedapp.EncryptedPayloadMigration) (sharedapp.EncryptedPayloadMigrationResult, error) {
	repository.migrationCalls++
	repository.migrationActor = actorUserID
	repository.migrationVault = vaultID
	repository.migrationID = accountID
	repository.migrationRev = expectedRevision
	repository.migrationKey = expectedKeyVersion
	repository.migration = migration
	repository.migrationBytes = append([]byte(nil), migration.ReplacementCiphertext...)
	return repository.migrationResult, repository.migrationErr
}

func (repository *sharedAccountRepositoryStub) Update(_ context.Context, actorUserID string, vaultID string, accountID string, expectedRevision int64, payload []byte, encryptionVersion int, expectedKeyVersion int64) (accountapp.SharedAccountMutationResult, error) {
	repository.updateCalls++
	repository.updateActor = actorUserID
	repository.updateVault = vaultID
	repository.updateID = accountID
	repository.updateRevision = expectedRevision
	repository.updatePayload = payload
	repository.updateSnapshot = append([]byte(nil), payload...)
	repository.updateVersion = encryptionVersion
	repository.updateKeyVersion = expectedKeyVersion
	return repository.updateResult, repository.updateErr
}

func (repository *sharedAccountRepositoryStub) Delete(_ context.Context, actorUserID string, vaultID string, accountID string, expectedRevision int64) (accountapp.SharedAccountMutationResult, error) {
	repository.deleteCalls++
	repository.deleteActor = actorUserID
	repository.deleteVault = vaultID
	repository.deleteID = accountID
	repository.deleteRevision = expectedRevision
	return repository.deleteResult, repository.deleteErr
}

func (repository *sharedAccountRepositoryStub) Restore(_ context.Context, actorUserID string, vaultID string, accountID string) (accountapp.SharedAccountMutationResult, error) {
	repository.restoreCalls++
	repository.restoreActor = actorUserID
	repository.restoreVault = vaultID
	repository.restoreID = accountID
	return repository.restoreResult, repository.restoreErr
}

func TestSharedAccountHandlersRegisterOperationsAndMapCreateUpdate(t *testing.T) {
	payload := sharedAccountTestPayload(2)
	created := sharedAccountTestValue(t, "synthetic-created-account", payload, 1)
	updated := sharedAccountTestValue(t, "synthetic-created-account", payload, 2)
	authorizer := &sharedAccountAuthorizerStub{userID: "synthetic-viewer", authorized: true}
	repository := &sharedAccountRepositoryStub{
		createResult: accountapp.SharedAccountMutationResult{Status: accountapp.SharedAccountMutationSuccess, Account: &created},
		updateResult: accountapp.SharedAccountMutationResult{Status: accountapp.SharedAccountMutationSuccess, Account: &updated},
	}
	handlers := NewSharedAccountHandlers(authorizer, repository).OperationHandlers()
	if len(handlers) != 5 {
		t.Fatalf("Shared Account handler map has %d operations; want five mutations", len(handlers))
	}
	encoded := base64.StdEncoding.EncodeToString(payload)
	createResponse := invokeSharedAccountHandler(t, handlers["postSharedvaultsVaultIdAccounts"], http.MethodPost,
		`{"encryptedPayload":"`+encoded+`","encryptionVersion":1.0,"expectedKeyVersion":7}`)
	if createResponse.Code != http.StatusCreated || !strings.Contains(createResponse.Body.String(), `"revision":1`) ||
		repository.createCalls != 1 || repository.createActor != "synthetic-viewer" || repository.createVault != "synthetic-vault" ||
		repository.createVersion != 1 || repository.createKeyVersion != 7 || string(repository.createSnapshot) != string(payload) {
		t.Fatalf("Shared Account create contract mismatch: response=%d body=%s auth=%#v repository=%#v", createResponse.Code, createResponse.Body.String(), authorizer, repository)
	}
	if !accountBytesZero(repository.createPayload) || !accountBytesZero(created.EncryptedPayload) {
		t.Fatal("create request or response ciphertext buffer was not cleared")
	}

	updateResponse := invokeSharedAccountHandler(t, handlers["patchSharedvaultsVaultIdAccounts"], http.MethodPatch,
		`{"accountId":"synthetic-account","encryptedPayload":"`+encoded+`","encryptionVersion":1,"expectedKeyVersion":8,"expectedRevision":3}`)
	if updateResponse.Code != http.StatusOK || !strings.Contains(updateResponse.Body.String(), `"revision":2`) ||
		repository.updateCalls != 1 || repository.updateActor != "synthetic-viewer" || repository.updateVault != "synthetic-vault" ||
		repository.updateID != "synthetic-account" || repository.updateRevision != 3 || repository.updateVersion != 1 ||
		repository.updateKeyVersion != 8 || string(repository.updateSnapshot) != string(payload) {
		t.Fatalf("Shared Account update contract mismatch: response=%d body=%s repository=%#v", updateResponse.Code, updateResponse.Body.String(), repository)
	}
	if !accountBytesZero(repository.updatePayload) || !accountBytesZero(updated.EncryptedPayload) {
		t.Fatal("update request or response ciphertext buffer was not cleared")
	}
	if authorizer.calls != 2 || authorizer.mutation != "account_mutation" {
		t.Fatalf("Shared Account mutation authorization=%#v; want fresh account_mutation admission", authorizer)
	}
}

func TestSharedAccountHandlersMapDeleteAndOwnerRestore(t *testing.T) {
	authorizer := &sharedAccountAuthorizerStub{userID: "synthetic-owner", authorized: true}
	repository := &sharedAccountRepositoryStub{
		deleteResult:  accountapp.SharedAccountMutationResult{Status: accountapp.SharedAccountMutationSuccess},
		restoreResult: accountapp.SharedAccountMutationResult{Status: accountapp.SharedAccountMutationSuccess},
	}
	handlers := NewSharedAccountHandlers(authorizer, repository).OperationHandlers()
	deleteResponse := invokeSharedAccountHandler(t, handlers["deleteSharedvaultsVaultIdAccounts"], http.MethodDelete,
		`{"accountId":"synthetic-account","expectedRevision":9}`)
	if deleteResponse.Code != http.StatusNoContent || deleteResponse.Body.Len() != 0 || repository.deleteCalls != 1 ||
		repository.deleteActor != "synthetic-owner" || repository.deleteVault != "synthetic-vault" ||
		repository.deleteID != "synthetic-account" || repository.deleteRevision != 9 {
		t.Fatalf("Shared Account delete response=%d body=%s repository=%#v", deleteResponse.Code, deleteResponse.Body.String(), repository)
	}
	restoreResponse := invokeSharedAccountHandler(t, handlers["putSharedvaultsVaultIdAccounts"], http.MethodPut,
		`{"accountId":"synthetic-account"}`)
	if restoreResponse.Code != http.StatusNoContent || restoreResponse.Body.Len() != 0 || repository.restoreCalls != 1 ||
		repository.restoreActor != "synthetic-owner" || repository.restoreVault != "synthetic-vault" || repository.restoreID != "synthetic-account" {
		t.Fatalf("Shared Account restore response=%d body=%s repository=%#v", restoreResponse.Code, restoreResponse.Body.String(), repository)
	}
}

func TestSharedAccountHandlersRejectInvalidBodiesBeforePersistence(t *testing.T) {
	authorizer := &sharedAccountAuthorizerStub{userID: "synthetic-owner", authorized: true}
	repository := &sharedAccountRepositoryStub{}
	handlers := NewSharedAccountHandlers(authorizer, repository).OperationHandlers()
	validPayload := base64.StdEncoding.EncodeToString(sharedAccountTestPayload(1))
	invalidBodies := []string{
		`{"encryptedPayload":"` + validPayload + `","encryptionVersion":2,"expectedKeyVersion":1}`,
		`{"encryptedPayload":"` + validPayload + `","encryptionVersion":1,"expectedKeyVersion":1,"tags":[]}`,
		`{"encryptedPayload":"` + base64.StdEncoding.EncodeToString(sharedAccountTestPayload(3)) + `","encryptionVersion":1,"expectedKeyVersion":1}`,
		`{"encryptedPayload":"` + base64.StdEncoding.EncodeToString([]byte{1, 2, 3}) + `","encryptionVersion":1,"expectedKeyVersion":1}`,
		`{"encryptedPayload":"not-base64","encryptionVersion":1,"expectedKeyVersion":1}`,
		`{"encryptedPayload":"` + validPayload + `","encryptionVersion":1,"expectedKeyVersion":0}`,
	}
	for _, body := range invalidBodies {
		response := invokeSharedAccountHandler(t, handlers["postSharedvaultsVaultIdAccounts"], http.MethodPost, body)
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "invalid_account") {
			t.Errorf("invalid Shared Account create response=%d %s", response.Code, response.Body.String())
		}
	}
	if repository.createCalls != 0 {
		t.Fatalf("invalid create input reached persistence %d times", repository.createCalls)
	}

	authorizer.authorized = false
	response := invokeSharedAccountHandler(t, handlers["postSharedvaultsVaultIdAccounts"], http.MethodPost, "not-json")
	if response.Code != http.StatusUnauthorized || repository.createCalls != 0 {
		t.Fatalf("unauthenticated malformed request response=%d repository calls=%d", response.Code, repository.createCalls)
	}
}

func TestSharedAccountHandlersMapMutationStatusesAndRepositoryErrors(t *testing.T) {
	tests := []struct {
		name       string
		status     accountapp.SharedAccountMutationStatus
		code       string
		statusCode int
	}{
		{name: "vault unavailable", status: accountapp.SharedAccountMutationVaultUnavailable, code: "shared_vault_unavailable", statusCode: http.StatusNotFound},
		{name: "permission denied", status: accountapp.SharedAccountMutationPermissionDenied, code: "account_permission_required", statusCode: http.StatusForbidden},
		{name: "stale revision", status: accountapp.SharedAccountMutationStaleRevision, code: "stale_revision", statusCode: http.StatusConflict},
		{name: "stale key version", status: accountapp.SharedAccountMutationStaleKeyVersion, code: "stale_key_version", statusCode: http.StatusConflict},
		{name: "account unavailable", status: accountapp.SharedAccountMutationAccountUnavailable, code: "account_unavailable", statusCode: http.StatusNotFound},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			authorizer := &sharedAccountAuthorizerStub{userID: "synthetic-member", authorized: true}
			repository := &sharedAccountRepositoryStub{createResult: accountapp.SharedAccountMutationResult{Status: test.status}}
			handler := NewSharedAccountHandlers(authorizer, repository).OperationHandlers()["postSharedvaultsVaultIdAccounts"]
			body := `{"encryptedPayload":"` + base64.StdEncoding.EncodeToString(sharedAccountTestPayload(1)) + `","encryptionVersion":1,"expectedKeyVersion":1}`
			response := invokeSharedAccountHandler(t, handler, http.MethodPost, body)
			if response.Code != test.statusCode || !strings.Contains(response.Body.String(), test.code) {
				t.Fatalf("mutation status response=%d %s; want %d %q", response.Code, response.Body.String(), test.statusCode, test.code)
			}
		})
	}

	failure := errors.New("synthetic repository detail")
	authorizer := &sharedAccountAuthorizerStub{userID: "synthetic-member", authorized: true}
	repository := &sharedAccountRepositoryStub{createErr: failure}
	handler := NewSharedAccountHandlers(authorizer, repository).OperationHandlers()["postSharedvaultsVaultIdAccounts"]
	requestBody := `{"encryptedPayload":"` + base64.StdEncoding.EncodeToString(sharedAccountTestPayload(1)) + `","encryptionVersion":1,"expectedKeyVersion":1}`
	request := httptest.NewRequest(http.MethodPost, "/v1/shared-vaults/synthetic-vault/accounts", strings.NewReader(requestBody))
	response := httptest.NewRecorder()
	context := echo.New().NewContext(request, response)
	context.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}})
	if err := handler(context); !errors.Is(err, failure) {
		t.Fatalf("repository failure=%v; want propagation to shared generic error handler", err)
	}
	if response.Body.Len() != 0 {
		t.Fatalf("repository error produced a local response: %s", response.Body.String())
	}
}

func TestSharedAccountPayloadMigrationMapsReplayAndClearsCiphertext(t *testing.T) {
	replacement := sharedAccountTestPayload(2)
	replacementDigest := sharedapp.SHA256Base64URL(replacement)
	authorizer := &sharedAccountAuthorizerStub{userID: "synthetic-member", authorized: true}
	repository := &sharedAccountRepositoryStub{migrationResult: sharedapp.EncryptedPayloadMigrationAlreadyCommitted}
	handler := NewSharedAccountHandlers(authorizer, repository).OperationHandlers()["postSharedvaultsVaultIdAccountsMigration"]
	requestBody, err := json.Marshal(map[string]any{
		"accountId":                   "synthetic-account",
		"expectedRevision":            4,
		"expectedKeyVersion":          7,
		"expectedEnvelopeVersion":     1,
		"replacementEnvelopeVersion":  2,
		"expectedCiphertextDigest":    strings.Repeat("a", 43),
		"replacementCiphertextDigest": replacementDigest,
		"replacementCiphertext":       base64.StdEncoding.EncodeToString(replacement),
		"operationId":                 replacementDigest,
	})
	if err != nil {
		t.Fatal(err)
	}
	response := invokeSharedAccountHandler(t, handler, http.MethodPost, string(requestBody))
	if response.Code != http.StatusNoContent || response.Body.Len() != 0 || repository.migrationCalls != 1 ||
		repository.migrationActor != "synthetic-member" || repository.migrationVault != "synthetic-vault" ||
		repository.migrationID != "synthetic-account" || repository.migrationRev != 4 || repository.migrationKey != 7 ||
		string(repository.migrationBytes) != string(replacement) {
		t.Fatalf("migration replay response=%d %s repository=%#v", response.Code, response.Body.String(), repository)
	}
	if !accountBytesZero(repository.migration.ReplacementCiphertext) {
		t.Fatal("migration replacement ciphertext buffer was not cleared after repository call")
	}

	repository.migrationResult = sharedapp.EncryptedPayloadMigrationConflict
	response = invokeSharedAccountHandler(t, handler, http.MethodPost, string(requestBody))
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "account_migration_conflict") {
		t.Fatalf("migration conflict response=%d %s", response.Code, response.Body.String())
	}
	repository.migrationCalls = 0
	invalid := strings.Replace(string(requestBody), `"operationId":"`+replacementDigest+`"`, `"operationId":"`+strings.Repeat("c", 43)+`"`, 1)
	response = invokeSharedAccountHandler(t, handler, http.MethodPost, invalid)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "invalid_account_migration") || repository.migrationCalls != 0 {
		t.Fatalf("invalid migration request response=%d %s repository calls=%d", response.Code, response.Body.String(), repository.migrationCalls)
	}
}

func invokeSharedAccountHandler(t *testing.T, handler httpapi.OperationHandler, method string, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, "/v1/shared-vaults/synthetic-vault/accounts", strings.NewReader(body))
	response := httptest.NewRecorder()
	ctx := echo.New().NewContext(request, response)
	ctx.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}})
	if err := handler(ctx); err != nil {
		t.Fatalf("Shared Account handler returned error: %v", err)
	}
	return response
}

func sharedAccountTestPayload(version byte) []byte {
	payload := make([]byte, 29)
	payload[0] = version
	for index := 1; index < len(payload); index++ {
		payload[index] = byte(index)
	}
	return payload
}

func sharedAccountTestValue(t *testing.T, id string, payload []byte, revision int64) accountdomain.EncryptedAuthenticatorAccount {
	t.Helper()
	account, err := accountdomain.NewEncryptedAuthenticatorAccount(id, "synthetic-vault", payload, 1, revision)
	if err != nil {
		t.Fatal(err)
	}
	return account
}
