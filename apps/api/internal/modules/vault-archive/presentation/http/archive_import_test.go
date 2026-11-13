package http

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	vaultarchivedomain "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-archive/domain"
)

const (
	archiveTestVaultID   = "synthetic-personal-vault-0001"
	archiveTestAccountID = "22222222-2222-4222-8222-222222222222"
)

type archiveImportAuthorizerStub struct {
	actorID string
	allowed bool
	action  string
}

func (authorizer *archiveImportAuthorizerStub) AuthorizeApplicationRequest(ctx *echo.Context, action string) (string, bool, error) {
	authorizer.action = action
	if !authorizer.allowed {
		return "", false, ctx.JSON(http.StatusUnauthorized, httpapi.ApiError{Error: "unauthorized"})
	}
	return authorizer.actorID, true, nil
}

type archiveImportRepositoryStub struct {
	result  vaultarchivedomain.EncryptedVaultImportResult
	request vaultarchivedomain.EncryptedVaultImport
	actorID string
	calls   int
	err     error
}

func (repository *archiveImportRepositoryStub) Import(_ context.Context, actorID string, request vaultarchivedomain.EncryptedVaultImport) (vaultarchivedomain.EncryptedVaultImportResult, error) {
	repository.calls++
	repository.actorID = actorID
	repository.request = request
	return repository.result, repository.err
}

func TestEncryptedVaultImportAuthenticatesAndImportsEncryptedAccounts(t *testing.T) {
	authorizer := &archiveImportAuthorizerStub{actorID: "synthetic-user-00001", allowed: true}
	repository := &archiveImportRepositoryStub{result: vaultarchivedomain.EncryptedVaultImportResult{
		Status:     vaultarchivedomain.ImportStatusImported,
		VaultID:    archiveTestVaultID,
		AccountIDs: []string{archiveTestAccountID},
	}}
	response := invokeArchiveImport(t, NewEncryptedVaultImportHandlers(authorizer, repository), validArchiveImportBody(t, "PERSONAL", "[]"), nil)
	if response.Code != http.StatusCreated || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("archive import response=%d body=%q headers=%v", response.Code, response.Body.String(), response.Header())
	}
	if authorizer.action != "archive_import" || repository.calls != 1 || repository.actorID != "synthetic-user-00001" {
		t.Fatalf("archive import dependencies mismatch: authorizer=%#v repository=%#v", authorizer, repository)
	}
	if repository.request.Destination.Kind != vaultarchivedomain.DestinationExisting || repository.request.Destination.Existing.VaultType != "PERSONAL" ||
		len(repository.request.Accounts) != 0 {
		t.Fatalf("unexpected parsed archive import: %#v", repository.request)
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["vaultId"] != archiveTestVaultID || payload["replayed"] != false || payload["vaultCreated"] != false {
		t.Fatalf("unexpected archive import response: %#v", payload)
	}
}

func TestEncryptedVaultImportMapsReplayAndBusinessErrors(t *testing.T) {
	for _, test := range []struct {
		name      string
		result    vaultarchivedomain.EncryptedVaultImportResult
		status    int
		wantError string
	}{
		{name: "replayed", result: vaultarchivedomain.EncryptedVaultImportResult{Status: vaultarchivedomain.ImportStatusReplayed, VaultID: archiveTestVaultID, AccountIDs: []string{archiveTestAccountID}}, status: http.StatusOK},
		{name: "destination unavailable", result: vaultarchivedomain.EncryptedVaultImportResult{Status: vaultarchivedomain.ImportStatusDestinationUnavailable}, status: http.StatusNotFound, wantError: "destination_unavailable"},
		{name: "conflict", result: vaultarchivedomain.EncryptedVaultImportResult{Status: vaultarchivedomain.ImportStatusConflict}, status: http.StatusConflict, wantError: "archive_import_conflict"},
	} {
		t.Run(test.name, func(t *testing.T) {
			authorizer := &archiveImportAuthorizerStub{actorID: "synthetic-user-00001", allowed: true}
			repository := &archiveImportRepositoryStub{result: test.result}
			body := validArchiveImportBody(t, "PERSONAL", "[]")
			response := invokeArchiveImport(t, NewEncryptedVaultImportHandlers(authorizer, repository), body, nil)
			if response.Code != test.status || response.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("archive import response=%d body=%q headers=%v", response.Code, response.Body.String(), response.Header())
			}
			if test.wantError != "" && !strings.Contains(response.Body.String(), test.wantError) {
				t.Fatalf("archive import error body=%q, want %q", response.Body.String(), test.wantError)
			}
		})
	}
}

func TestEncryptedVaultImportRejectsInvalidBodyBeforeRepositoryCall(t *testing.T) {
	for _, test := range []struct {
		name      string
		body      string
		headers   http.Header
		status    int
		wantError string
	}{
		{name: "unknown field", body: `{"destination":{"kind":"EXISTING","vaultId":"synthetic-vault-01","vaultType":"PERSONAL","extra":true},"accounts":[]}`, status: http.StatusBadRequest, wantError: "invalid_archive_import"},
		{name: "missing accounts", body: `{"destination":{"kind":"EXISTING","vaultId":"synthetic-vault-01","vaultType":"PERSONAL"}}`, status: http.StatusBadRequest, wantError: "invalid_archive_import"},
		{name: "duplicate account ids", body: duplicateArchiveAccountsBody(), status: http.StatusBadRequest, wantError: "invalid_archive_import"},
		{name: "invalid content length", body: `{}`, headers: http.Header{"Content-Length": []string{"eight"}}, status: http.StatusBadRequest, wantError: "invalid_archive_import"},
		{name: "unsafe content length", body: `{}`, headers: http.Header{"Content-Length": []string{"9007199254740992"}}, status: http.StatusBadRequest, wantError: "invalid_archive_import"},
		{name: "declared too large", body: `{}`, headers: http.Header{"Content-Length": []string{"8388609"}}, status: http.StatusRequestEntityTooLarge, wantError: "archive_import_too_large"},
		{name: "invalid ciphertext prefix", body: invalidArchiveCiphertextBody(), status: http.StatusBadRequest, wantError: "invalid_archive_import"},
	} {
		t.Run(test.name, func(t *testing.T) {
			authorizer := &archiveImportAuthorizerStub{actorID: "synthetic-user-00001", allowed: true}
			repository := &archiveImportRepositoryStub{result: vaultarchivedomain.EncryptedVaultImportResult{Status: vaultarchivedomain.ImportStatusImported}}
			response := invokeArchiveImport(t, NewEncryptedVaultImportHandlers(authorizer, repository), test.body, test.headers)
			if response.Code != test.status || !strings.Contains(response.Body.String(), test.wantError) || repository.calls != 0 {
				t.Fatalf("invalid archive import response=%d body=%q repository calls=%d", response.Code, response.Body.String(), repository.calls)
			}
			if response.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("archive import error response is cacheable: %v", response.Header())
			}
		})
	}
}

func TestEncryptedVaultImportAuthorizesBeforeParsingRequest(t *testing.T) {
	authorizer := &archiveImportAuthorizerStub{allowed: false}
	repository := &archiveImportRepositoryStub{}
	response := invokeArchiveImport(t, NewEncryptedVaultImportHandlers(authorizer, repository), "not-json", http.Header{"Content-Length": []string{"bad"}})
	if response.Code != http.StatusUnauthorized || authorizer.action != "archive_import" || repository.calls != 0 {
		t.Fatalf("authorization did not precede body parsing: status=%d action=%q calls=%d", response.Code, authorizer.action, repository.calls)
	}
}

func TestEncryptedVaultImportClearsDecodedCiphertextAfterRepositoryCall(t *testing.T) {
	authorizer := &archiveImportAuthorizerStub{actorID: "synthetic-user-00001", allowed: true}
	repository := &archiveImportRepositoryStub{result: vaultarchivedomain.EncryptedVaultImportResult{Status: vaultarchivedomain.ImportStatusImported}}
	response := invokeArchiveImport(t, NewEncryptedVaultImportHandlers(authorizer, repository), validArchiveImportBody(t, "PERSONAL", validArchiveAccountsJSON()), nil)
	if response.Code != http.StatusCreated || repository.calls != 1 {
		t.Fatalf("archive import response=%d body=%q calls=%d", response.Code, response.Body.String(), repository.calls)
	}
	for _, value := range repository.request.Accounts[0].EncryptedPayload {
		if value != 0 {
			t.Fatal("decoded archive ciphertext was retained after request handling")
		}
	}
}

func TestEncryptedVaultImportAcceptsAnEmptyArchiveAccountList(t *testing.T) {
	authorizer := &archiveImportAuthorizerStub{actorID: "synthetic-user-00001", allowed: true}
	repository := &archiveImportRepositoryStub{result: vaultarchivedomain.EncryptedVaultImportResult{Status: vaultarchivedomain.ImportStatusImported}}
	response := invokeArchiveImport(t, NewEncryptedVaultImportHandlers(authorizer, repository), validArchiveImportBody(t, "PERSONAL", "[]"), nil)
	if response.Code != http.StatusCreated || repository.calls != 1 || repository.request.Accounts == nil {
		t.Fatalf("empty archive parity changed: status=%d calls=%d accounts=%#v", response.Code, repository.calls, repository.request.Accounts)
	}
}

func invokeArchiveImport(t *testing.T, handlers *EncryptedVaultImportHandlers, body string, headers http.Header) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/v1/vault-imports", strings.NewReader(body))
	if headers != nil {
		request.Header = headers.Clone()
	}
	response := httptest.NewRecorder()
	ctx := echo.New().NewContext(request, response)
	if err := handlers.OperationHandlers()["postVaultimports"](ctx); err != nil {
		t.Fatalf("archive import handler returned error: %v", err)
	}
	return response
}

func validArchiveImportBody(t *testing.T, vaultType string, accounts string) string {
	t.Helper()
	body := fmt.Sprintf(`{"destination":{"kind":"EXISTING","vaultId":%q,"vaultType":%q},"accounts":%s}`, archiveTestVaultID, vaultType, accounts)
	if vaultType == "SHARED" {
		body = fmt.Sprintf(`{"destination":{"kind":"EXISTING","vaultId":%q,"vaultType":"SHARED","expectedKeyVersion":1},"accounts":%s}`, archiveTestVaultID, accounts)
	}
	return body
}

func validArchiveAccountsJSON() string {
	return fmt.Sprintf(`[{"id":%q,"encryptedPayload":%q,"encryptionVersion":1}]`, archiveTestAccountID, base64.StdEncoding.EncodeToString(syntheticArchiveCiphertext(1)))
}

func duplicateArchiveAccountsBody() string {
	account := fmt.Sprintf(`{"id":%q,"encryptedPayload":%q,"encryptionVersion":1}`, archiveTestAccountID, base64.StdEncoding.EncodeToString(syntheticArchiveCiphertext(1)))
	return fmt.Sprintf(`{"destination":{"kind":"EXISTING","vaultId":%q,"vaultType":"PERSONAL"},"accounts":[%s,%s]}`, archiveTestVaultID, account, account)
}

func invalidArchiveCiphertextBody() string {
	ciphertext := syntheticArchiveCiphertext(3)
	return fmt.Sprintf(`{"destination":{"kind":"EXISTING","vaultId":%q,"vaultType":"PERSONAL"},"accounts":[{"id":%q,"encryptedPayload":%q,"encryptionVersion":1}]}`,
		archiveTestVaultID, archiveTestAccountID, base64.StdEncoding.EncodeToString(ciphertext))
}

func syntheticArchiveCiphertext(prefix byte) []byte {
	ciphertext := bytes.Repeat([]byte{0x2a}, 32)
	ciphertext[0] = prefix
	return ciphertext
}
