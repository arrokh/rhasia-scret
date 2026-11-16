package handler

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

	apiEntity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

type accountAuthorizerStub struct {
	ownerID    string
	authorized bool
	mutation   string
	calls      int
}

func (authorizer *accountAuthorizerStub) AuthorizeApplicationRequest(ctx *echo.Context, mutation string) (string, bool, error) {
	authorizer.calls++
	authorizer.mutation = mutation
	if !authorizer.authorized {
		return "", false, ctx.JSON(http.StatusUnauthorized, httpapi.ApiError{Error: "unauthenticated"})
	}
	return authorizer.ownerID, true, nil
}

type personalAccountRepositoryStub struct {
	listCalls int
	listOwner string
	listVault string
	listed    []apiEntity.EncryptedAuthenticatorAccount
	listErr   error

	createCalls   int
	createOwner   string
	createVault   string
	createdInput  apiService.NewEncryptedAccount
	createPayload []byte
	created       apiEntity.EncryptedAuthenticatorAccount
	createErr     error

	updateCalls  int
	updateOwner  string
	updateVault  string
	updateID     string
	updateRev    int64
	updatedInput apiService.NewEncryptedAccount
	updated      *apiEntity.EncryptedAuthenticatorAccount
	updateErr    error

	deleteCalls int
	deleted     bool
	deleteErr   error

	restoreCalls int
	restored     bool
	restoreErr   error

	migrationCalls  int
	migration       sharedapp.EncryptedPayloadMigration
	migrationOwner  string
	migrationVault  string
	migrationID     string
	migrationRev    int64
	migrationKey    int64
	migrationBytes  []byte
	migrationResult sharedapp.EncryptedPayloadMigrationResult
	migrationErr    error
}

func (repository *personalAccountRepositoryStub) List(_ context.Context, ownerID string, vaultID string) ([]apiEntity.EncryptedAuthenticatorAccount, error) {
	repository.listCalls++
	repository.listOwner = ownerID
	repository.listVault = vaultID
	return repository.listed, repository.listErr
}

func (repository *personalAccountRepositoryStub) Create(_ context.Context, ownerID string, vaultID string, input apiService.NewEncryptedAccount) (apiEntity.EncryptedAuthenticatorAccount, error) {
	repository.createCalls++
	repository.createOwner = ownerID
	repository.createVault = vaultID
	repository.createdInput = input
	repository.createPayload = append([]byte(nil), input.EncryptedPayload...)
	return repository.created, repository.createErr
}

func (repository *personalAccountRepositoryStub) Update(_ context.Context, ownerID string, vaultID string, accountID string, expectedRevision int64, input apiService.NewEncryptedAccount) (*apiEntity.EncryptedAuthenticatorAccount, error) {
	repository.updateCalls++
	repository.updateOwner = ownerID
	repository.updateVault = vaultID
	repository.updateID = accountID
	repository.updateRev = expectedRevision
	repository.updatedInput = input
	return repository.updated, repository.updateErr
}

func (repository *personalAccountRepositoryStub) Delete(_ context.Context, _ string, _ string, _ string, _ int64) (bool, error) {
	repository.deleteCalls++
	return repository.deleted, repository.deleteErr
}

func (repository *personalAccountRepositoryStub) Restore(_ context.Context, _ string, _ string, _ string) (bool, error) {
	repository.restoreCalls++
	return repository.restored, repository.restoreErr
}

func (repository *personalAccountRepositoryStub) MigratePayload(_ context.Context, ownerID string, vaultID string, accountID string, expectedRevision int64, expectedKeyVersion int64, migration sharedapp.EncryptedPayloadMigration) (sharedapp.EncryptedPayloadMigrationResult, error) {
	repository.migrationCalls++
	repository.migrationOwner = ownerID
	repository.migrationVault = vaultID
	repository.migrationID = accountID
	repository.migrationRev = expectedRevision
	repository.migrationKey = expectedKeyVersion
	repository.migration = migration
	repository.migrationBytes = append([]byte(nil), migration.ReplacementCiphertext...)
	return repository.migrationResult, repository.migrationErr
}

func TestPersonalAccountHandlersMapOperationsAndClearReadBuffers(t *testing.T) {
	payload := []byte{1, 2, 3, 4}
	account, err := apiEntity.NewEncryptedAuthenticatorAccount("synthetic-account", "synthetic-vault", payload, 1, 2)
	if err != nil {
		t.Fatal(err)
	}
	authorizer := &accountAuthorizerStub{ownerID: "synthetic-owner", authorized: true}
	repository := &personalAccountRepositoryStub{listed: []apiEntity.EncryptedAuthenticatorAccount{account}}
	handlers := NewPersonalAccountHandlers(authorizer, repository).OperationHandlers()
	if len(handlers) != 6 {
		t.Fatalf("personal account handler map has %d operations, want six", len(handlers))
	}
	response := invokeAccountHandler(t, handlers["getVaultsVaultIdAccounts"], http.MethodGet, "")
	if response.Code != http.StatusOK {
		t.Fatalf("list response=%d %s", response.Code, response.Body.String())
	}
	var result []map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode Personal Account list: %v", err)
	}
	if len(result) != 1 || result[0]["id"] != account.ID || result[0]["encryptedPayload"] != base64.StdEncoding.EncodeToString(payload) || result[0]["encryptionVersion"] != float64(1) || result[0]["revision"] != float64(2) || len(result[0]) != 4 {
		t.Fatalf("unexpected Personal Account response: %#v", result)
	}
	if authorizer.calls != 1 || authorizer.mutation != "" || repository.listCalls != 1 || repository.listOwner != "synthetic-owner" || repository.listVault != "synthetic-vault" {
		t.Fatalf("list did not authenticate and read the requested Vault: auth=%#v repo=%#v", authorizer, repository)
	}
	if !accountBytesZero(repository.listed[0].EncryptedPayload) {
		t.Fatal("listed ciphertext buffer was not cleared after response encoding")
	}
}

func TestPersonalAccountCreateUpdateDeleteAndRestoreContracts(t *testing.T) {
	payload := []byte{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}
	created, err := apiEntity.NewEncryptedAuthenticatorAccount("synthetic-created-account", "synthetic-vault", payload, 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	updated, err := apiEntity.NewEncryptedAuthenticatorAccount("synthetic-created-account", "synthetic-vault", payload, 1, 3)
	if err != nil {
		t.Fatal(err)
	}
	authorizer := &accountAuthorizerStub{ownerID: "synthetic-owner", authorized: true}
	repository := &personalAccountRepositoryStub{created: created, updated: &updated, deleted: false, restored: false}
	handlers := NewPersonalAccountHandlers(authorizer, repository).OperationHandlers()
	encoded := base64.StdEncoding.EncodeToString(payload)
	createdResponse := invokeAccountHandler(t, handlers["postVaultsVaultIdAccounts"], http.MethodPost,
		`{"encryptedPayload":"`+encoded+`","encryptionVersion":1.0,"source":"LOCAL_VAULT_COPY"}`)
	if createdResponse.Code != http.StatusCreated || repository.createCalls != 1 || repository.createOwner != "synthetic-owner" || repository.createVault != "synthetic-vault" ||
		repository.createdInput.EncryptionVersion != 1 || repository.createdInput.Source != apiService.AccountCopySourceLocalVault || string(repository.createPayload) != string(payload) {
		t.Fatalf("create contract mismatch: response=%d body=%s repo=%#v", createdResponse.Code, createdResponse.Body.String(), repository)
	}
	if !accountBytesZero(repository.createdInput.EncryptedPayload) {
		t.Fatal("create request ciphertext buffer was not cleared after persistence")
	}

	updatedResponse := invokeAccountHandler(t, handlers["patchVaultsVaultIdAccounts"], http.MethodPatch,
		`{"accountId":"synthetic-account","encryptedPayload":"`+encoded+`","encryptionVersion":1,"expectedRevision":2}`)
	if updatedResponse.Code != http.StatusOK || repository.updateCalls != 1 || repository.updateOwner != "synthetic-owner" || repository.updateVault != "synthetic-vault" ||
		repository.updateID != "synthetic-account" || repository.updateRev != 2 || repository.updatedInput.EncryptionVersion != 1 {
		t.Fatalf("update contract mismatch: response=%d body=%s repo=%#v", updatedResponse.Code, updatedResponse.Body.String(), repository)
	}
	if !accountBytesZero(repository.updatedInput.EncryptedPayload) {
		t.Fatal("update request ciphertext buffer was not cleared after persistence")
	}
	updated.Clear()

	deletedResponse := invokeAccountHandler(t, handlers["deleteVaultsVaultIdAccounts"], http.MethodDelete,
		`{"accountId":"synthetic-account","expectedRevision":3}`)
	if deletedResponse.Code != http.StatusConflict || repository.deleteCalls != 1 || !strings.Contains(deletedResponse.Body.String(), "stale_revision") {
		t.Fatalf("stale delete response=%d %s", deletedResponse.Code, deletedResponse.Body.String())
	}
	restoredResponse := invokeAccountHandler(t, handlers["putVaultsVaultIdAccounts"], http.MethodPut,
		`{"accountId":"synthetic-account"}`)
	if restoredResponse.Code != http.StatusNotFound || repository.restoreCalls != 1 || !strings.Contains(restoredResponse.Body.String(), "account_unavailable") {
		t.Fatalf("unavailable restore response=%d %s", restoredResponse.Code, restoredResponse.Body.String())
	}
	created.Clear()
}

func TestPersonalAccountHandlersRejectInvalidInputAndUnauthenticatedRequests(t *testing.T) {
	authorizer := &accountAuthorizerStub{ownerID: "synthetic-owner", authorized: true}
	repository := &personalAccountRepositoryStub{}
	handlers := NewPersonalAccountHandlers(authorizer, repository).OperationHandlers()
	validPayload := base64.StdEncoding.EncodeToString([]byte{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13})
	invalidBodies := []string{
		`{"encryptedPayload":"` + validPayload + `","encryptionVersion":2}`,
		`{"encryptedPayload":"` + validPayload + `","encryptionVersion":1,"tags":["Synthetic"]}`,
		`{"encryptedPayload":"` + validPayload + `","encryptionVersion":1,"source":null}`,
		`{"encryptedPayload":"` + validPayload + `","encryptionVersion":1,"source":"not-supported"}`,
		`{"encryptedPayload":"not-base64","encryptionVersion":1}`,
		`{"encryptedPayload":"` + validPayload + `","encryptionVersion":1,"expectedRevision":0,"accountId":"x"}`,
	}
	for _, body := range invalidBodies {
		response := invokeAccountHandler(t, handlers["postVaultsVaultIdAccounts"], http.MethodPost, body)
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "invalid_account") {
			t.Errorf("invalid account request response=%d %s", response.Code, response.Body.String())
		}
	}
	if repository.createCalls != 0 {
		t.Fatalf("invalid input reached account persistence %d times", repository.createCalls)
	}

	authorizer.authorized = false
	response := invokeAccountHandler(t, handlers["getVaultsVaultIdAccounts"], http.MethodGet, "")
	if response.Code != http.StatusUnauthorized || repository.listCalls != 0 {
		t.Fatalf("unauthenticated read response=%d list calls=%d", response.Code, repository.listCalls)
	}
}

func TestPersonalAccountHandlersPreserveUnavailableMappingForRepositoryFailures(t *testing.T) {
	failure := errors.New("synthetic repository detail")
	repository := &personalAccountRepositoryStub{
		listErr: failure, createErr: failure, updateErr: failure, deleteErr: failure, restoreErr: failure,
	}
	authorizer := &accountAuthorizerStub{ownerID: "synthetic-owner", authorized: true}
	handlers := NewPersonalAccountHandlers(authorizer, repository).OperationHandlers()
	encoded := base64.StdEncoding.EncodeToString([]byte{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13})
	cases := []struct {
		name        string
		operationID string
		method      string
		body        string
	}{
		{name: "list", operationID: "getVaultsVaultIdAccounts", method: http.MethodGet},
		{name: "create", operationID: "postVaultsVaultIdAccounts", method: http.MethodPost, body: `{"encryptedPayload":"` + encoded + `","encryptionVersion":1}`},
		{name: "update", operationID: "patchVaultsVaultIdAccounts", method: http.MethodPatch, body: `{"accountId":"synthetic-account","encryptedPayload":"` + encoded + `","encryptionVersion":1,"expectedRevision":1}`},
		{name: "delete", operationID: "deleteVaultsVaultIdAccounts", method: http.MethodDelete, body: `{"accountId":"synthetic-account","expectedRevision":1}`},
		{name: "restore", operationID: "putVaultsVaultIdAccounts", method: http.MethodPut, body: `{"accountId":"synthetic-account"}`},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			response := invokeAccountHandler(t, handlers[test.operationID], test.method, test.body)
			if response.Code != http.StatusNotFound || !strings.Contains(response.Body.String(), `"error":"vault_unavailable"`) || strings.Contains(response.Body.String(), "synthetic repository detail") {
				t.Fatalf("repository failure response=%d %s", response.Code, response.Body.String())
			}
		})
	}
}

func TestPersonalAccountMigrationMapsSuccessAndClearsCiphertext(t *testing.T) {
	expected := make([]byte, 64)
	expected[0] = 1
	replacement := make([]byte, 65)
	replacement[0] = 2
	replacementDigest := sharedapp.SHA256Base64URL(replacement)
	body, err := json.Marshal(map[string]any{
		"accountId":                   "synthetic-account",
		"expectedRevision":            2,
		"expectedKeyVersion":          1,
		"expectedEnvelopeVersion":     1,
		"replacementEnvelopeVersion":  2,
		"expectedCiphertextDigest":    sharedapp.SHA256Base64URL(expected),
		"replacementCiphertextDigest": replacementDigest,
		"replacementCiphertext":       base64.StdEncoding.EncodeToString(replacement),
		"operationId":                 replacementDigest,
	})
	if err != nil {
		t.Fatal(err)
	}
	bodyJSON := string(body)
	bodyJSON = strings.Replace(bodyJSON, `"expectedEnvelopeVersion":1`, `"expectedEnvelopeVersion":1.0`, 1)
	bodyJSON = strings.Replace(bodyJSON, `"replacementEnvelopeVersion":2`, `"replacementEnvelopeVersion":2.0`, 1)
	authorizer := &accountAuthorizerStub{ownerID: "synthetic-owner", authorized: true}
	repository := &personalAccountRepositoryStub{migrationResult: sharedapp.EncryptedPayloadMigrationCommitted}
	handlers := NewPersonalAccountHandlers(authorizer, repository).OperationHandlers()
	response := invokeAccountHandler(t, handlers["postVaultsVaultIdAccountsMigration"], http.MethodPost, bodyJSON)
	if response.Code != http.StatusNoContent || repository.migrationCalls != 1 || authorizer.mutation != "account_mutation" ||
		repository.migrationOwner != "synthetic-owner" || repository.migrationVault != "synthetic-vault" || repository.migrationID != "synthetic-account" ||
		repository.migrationRev != 2 || repository.migrationKey != 1 || string(repository.migrationBytes) != string(replacement) {
		t.Fatalf("Personal Account migration response=%d %s repo=%#v", response.Code, response.Body.String(), repository)
	}
	if !accountBytesZero(repository.migration.ReplacementCiphertext) {
		t.Fatal("migration replacement buffer was not cleared after repository call")
	}

	repository.migrationErr = errors.New("synthetic repository failure")
	request := httptest.NewRequest(http.MethodPost, "/v1/vaults/synthetic-vault/accounts/migration", strings.NewReader(bodyJSON))
	response = httptest.NewRecorder()
	ctx := echo.New().NewContext(request, response)
	ctx.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}})
	if err := handlers["postVaultsVaultIdAccountsMigration"](ctx); !errors.Is(err, repository.migrationErr) {
		t.Fatalf("migration operational error=%v, want repository error to reach HTTP error middleware", err)
	}
	if response.Body.Len() != 0 {
		t.Fatalf("migration operational error was mapped locally to HTTP response: %s", response.Body.String())
	}
}

func invokeAccountHandler(t *testing.T, handler httpapi.OperationHandler, method string, body string) *httptest.ResponseRecorder {
	t.Helper()
	var requestBody *strings.Reader
	if method == http.MethodGet {
		requestBody = strings.NewReader("")
	} else {
		requestBody = strings.NewReader(body)
	}
	request := httptest.NewRequest(method, "/v1/vaults/synthetic-vault/accounts", requestBody)
	response := httptest.NewRecorder()
	ctx := echo.New().NewContext(request, response)
	ctx.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}})
	if err := handler(ctx); err != nil {
		t.Fatalf("Personal Account handler returned error: %v", err)
	}
	return response
}

func accountBytesZero(value []byte) bool {
	for _, byteValue := range value {
		if byteValue != 0 {
			return false
		}
	}
	return true
}
