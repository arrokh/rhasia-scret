package http

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	auditapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/audit"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

type auditAuthorizerStub struct {
	userID     string
	authorized bool
	mutations  []string
}

func (authorizer *auditAuthorizerStub) AuthorizeApplicationRequest(ctx *echo.Context, mutation string) (string, bool, error) {
	authorizer.mutations = append(authorizer.mutations, mutation)
	if !authorizer.authorized {
		return "", false, ctx.JSON(http.StatusUnauthorized, httpapi.ApiError{Error: "unauthenticated"})
	}
	return authorizer.userID, true, nil
}

type vaultAuditRepositoryStub struct {
	accessCalls     int
	accessActor     string
	accessVault     string
	accessAccount   string
	accessRecorded  bool
	accessErr       error
	copyCalls       int
	copyOwner       string
	copyVault       string
	copyAccounts    []string
	copyRecorded    bool
	copyErr         error
	archiveCalls    int
	archiveOwner    string
	archiveVault    string
	archiveRecorded bool
	archiveErr      error
	listCalls       int
	listOwner       string
	listVault       string
	listFilter      auditapp.VaultAuditFilter
	listRequest     sharedapp.CursorPageRequest
	listPage        *sharedapp.CursorPage[auditapp.RedactedVaultAuditEvent]
	listErr         error
}

func (repository *vaultAuditRepositoryStub) RecordAccountAccess(_ context.Context, actorID, vaultID, accountID string) (bool, error) {
	repository.accessCalls++
	repository.accessActor = actorID
	repository.accessVault = vaultID
	repository.accessAccount = accountID
	return repository.accessRecorded, repository.accessErr
}

func (repository *vaultAuditRepositoryStub) RecordPersonalAccountCopiesToLocal(_ context.Context, ownerID, vaultID string, accountIDs []string) (bool, error) {
	repository.copyCalls++
	repository.copyOwner = ownerID
	repository.copyVault = vaultID
	repository.copyAccounts = append([]string(nil), accountIDs...)
	return repository.copyRecorded, repository.copyErr
}

func (repository *vaultAuditRepositoryStub) RecordArchiveExport(_ context.Context, ownerID, vaultID string) (bool, error) {
	repository.archiveCalls++
	repository.archiveOwner = ownerID
	repository.archiveVault = vaultID
	return repository.archiveRecorded, repository.archiveErr
}

func (repository *vaultAuditRepositoryStub) ListForOwner(_ context.Context, ownerID, vaultID string, filter auditapp.VaultAuditFilter, request sharedapp.CursorPageRequest) (*sharedapp.CursorPage[auditapp.RedactedVaultAuditEvent], error) {
	repository.listCalls++
	repository.listOwner = ownerID
	repository.listVault = vaultID
	repository.listFilter = filter
	repository.listRequest = request
	return repository.listPage, repository.listErr
}

func TestVaultAuditMutationRoutesAuthorizeAndRecordOnlyRequestedEvents(t *testing.T) {
	authorizer := &auditAuthorizerStub{userID: "synthetic-actor", authorized: true}
	repository := &vaultAuditRepositoryStub{accessRecorded: true, copyRecorded: true}
	handlers := NewVaultAuditHandlers(authorizer, repository).OperationHandlers()
	sharedBody := `{"eventType":"ACCOUNT_ACCESSED","accountId":"synthetic-account"}`
	sharedResponse := invokeVaultAuditHandler(t, handlers["postSharedvaultsVaultIdAuditevents"], http.MethodPost, "/v1/shared-vaults/synthetic-vault/audit-events", sharedBody, "synthetic-vault")
	if sharedResponse.Code != http.StatusNoContent || repository.accessCalls != 1 || repository.accessActor != "synthetic-actor" ||
		repository.accessVault != "synthetic-vault" || repository.accessAccount != "synthetic-account" || len(authorizer.mutations) != 1 || authorizer.mutations[0] != "audit_event" {
		t.Fatalf("Shared Vault access-audit response=%d %s auth=%#v repository=%#v", sharedResponse.Code, sharedResponse.Body.String(), authorizer, repository)
	}
	personalBody := `{"eventType":"ACCOUNT_COPIED_TO_LOCAL","accountIds":["synthetic-account-a","synthetic-account-b"]}`
	personalResponse := invokeVaultAuditHandler(t, handlers["postVaultsVaultIdAuditevents"], http.MethodPost, "/v1/vaults/synthetic-personal-vault/audit-events", personalBody, "synthetic-personal-vault")
	if personalResponse.Code != http.StatusNoContent || repository.copyCalls != 1 || repository.copyOwner != "synthetic-actor" ||
		repository.copyVault != "synthetic-personal-vault" || len(repository.copyAccounts) != 2 || repository.copyAccounts[0] != "synthetic-account-a" ||
		repository.copyAccounts[1] != "synthetic-account-b" || len(authorizer.mutations) != 2 || authorizer.mutations[1] != "account_mutation" {
		t.Fatalf("Personal Vault copy-audit response=%d %s auth=%#v repository=%#v", personalResponse.Code, personalResponse.Body.String(), authorizer, repository)
	}
}

func TestVaultAuditGetFiltersAndEncodesScopedTimestampCursor(t *testing.T) {
	createdAt := time.Date(2026, time.July, 8, 9, 10, 11, 123_000_000, time.UTC)
	cursor := &sharedapp.TimestampCursor{CreatedAt: createdAt, Key: "synthetic-audit-id"}
	accountID := "synthetic-account"
	actorID := "synthetic-actor"
	authorizer := &auditAuthorizerStub{userID: "synthetic-owner", authorized: true}
	repository := &vaultAuditRepositoryStub{listPage: &sharedapp.CursorPage[auditapp.RedactedVaultAuditEvent]{
		Items: []auditapp.RedactedVaultAuditEvent{{
			ID: "synthetic-audit-id", EventType: "ACCOUNT_ACCESSED", TargetID: &accountID,
			ActorUserID: actorID, ActorEmail: "synthetic-actor@example.test", CreatedAt: createdAt,
		}},
		NextCursor: cursor,
	}}
	handler := NewVaultAuditHandlers(authorizer, repository).OperationHandlers()["getSharedvaultsVaultIdAuditevents"]
	response := invokeVaultAuditHandler(t, handler, http.MethodGet,
		"/v1/shared-vaults/synthetic-vault/audit-events?accountId=synthetic-account&actorUserId=synthetic-actor&limit=1", "", "synthetic-vault")
	if response.Code != http.StatusOK || repository.listCalls != 1 || repository.listOwner != "synthetic-owner" || repository.listVault != "synthetic-vault" ||
		repository.listFilter.AccountID == nil || *repository.listFilter.AccountID != accountID || repository.listFilter.ActorUserID == nil || *repository.listFilter.ActorUserID != actorID ||
		repository.listRequest.Limit != 1 || repository.listRequest.Cursor != nil {
		t.Fatalf("audit list response=%d %s repository=%#v", response.Code, response.Body.String(), repository)
	}
	var body auditPageResponse
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode audit list response: %v", err)
	}
	if len(body.Events) != 1 || body.Events[0].ID != "synthetic-audit-id" || body.Events[0].ActorEmail != "synthetic-actor@example.test" ||
		body.Events[0].CreatedAt != "2026-07-08T09:10:11.123Z" || body.NextCursor == nil {
		t.Fatalf("unexpected audit list response: %#v", body)
	}
	requestWithCursor := "/v1/shared-vaults/synthetic-vault/audit-events?accountId=synthetic-account&actorUserId=synthetic-actor&limit=1&cursor=" + *body.NextCursor
	response = invokeVaultAuditHandler(t, handler, http.MethodGet, requestWithCursor, "", "synthetic-vault")
	if response.Code != http.StatusOK || repository.listCalls != 2 || repository.listRequest.Cursor == nil ||
		!repository.listRequest.Cursor.CreatedAt.Equal(createdAt) || repository.listRequest.Cursor.Key != cursor.Key {
		t.Fatalf("audit list cursor request response=%d %s request=%#v", response.Code, response.Body.String(), repository.listRequest)
	}
}

func TestVaultAuditRoutesRejectInvalidRequestsAndMapUnavailableScope(t *testing.T) {
	authorizer := &auditAuthorizerStub{userID: "synthetic-user", authorized: true}
	repository := &vaultAuditRepositoryStub{}
	handlers := NewVaultAuditHandlers(authorizer, repository).OperationHandlers()
	invalidSharedBodies := []string{
		`{"eventType":"ACCOUNT_COPIED_TO_LOCAL","accountId":"synthetic-account"}`,
		`{"eventType":"ACCOUNT_ACCESSED","accountId":"synthetic-account","secret":"synthetic-extra"}`,
		`{"eventType":"ACCOUNT_ACCESSED","accountId":""}`,
	}
	for _, body := range invalidSharedBodies {
		response := invokeVaultAuditHandler(t, handlers["postSharedvaultsVaultIdAuditevents"], http.MethodPost, "/v1/shared-vaults/synthetic-vault/audit-events", body, "synthetic-vault")
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "invalid_audit_event") {
			t.Errorf("invalid Shared Vault audit response=%d %s", response.Code, response.Body.String())
		}
	}
	invalidPersonalBodies := []string{
		`{"eventType":"ACCOUNT_COPIED_TO_LOCAL","accountIds":[]}`,
		`{"eventType":"ACCOUNT_COPIED_TO_LOCAL","accountIds":["synthetic-account","synthetic-account"]}`,
		`{"eventType":"ACCOUNT_COPIED_TO_LOCAL","accountIds":null}`,
	}
	for _, body := range invalidPersonalBodies {
		response := invokeVaultAuditHandler(t, handlers["postVaultsVaultIdAuditevents"], http.MethodPost, "/v1/vaults/synthetic-vault/audit-events", body, "synthetic-vault")
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "invalid_copy_audit") {
			t.Errorf("invalid Personal Vault audit response=%d %s", response.Code, response.Body.String())
		}
	}
	for _, query := range []string{"?accountId=", "?actorUserId=" + strings.Repeat("a", 129), "?limit=0", "?cursor=bad"} {
		response := invokeVaultAuditHandler(t, handlers["getVaultsVaultIdAuditevents"], http.MethodGet, "/v1/vaults/synthetic-vault/audit-events"+query, "", "synthetic-vault")
		if response.Code != http.StatusBadRequest {
			t.Errorf("invalid Vault audit query %q response=%d %s", query, response.Code, response.Body.String())
		}
	}
	if repository.accessCalls != 0 || repository.copyCalls != 0 || repository.listCalls != 0 {
		t.Fatalf("invalid audit requests reached persistence: %#v", repository)
	}
	repository.listPage = nil
	response := invokeVaultAuditHandler(t, handlers["getVaultsVaultIdAuditevents"], http.MethodGet, "/v1/vaults/synthetic-vault/audit-events", "", "synthetic-vault")
	if response.Code != http.StatusNotFound || !strings.Contains(response.Body.String(), "owner_access_required") {
		t.Fatalf("unavailable owner audit response=%d %s", response.Code, response.Body.String())
	}
	authorizer.authorized = false
	response = invokeVaultAuditHandler(t, handlers["postSharedvaultsVaultIdAuditevents"], http.MethodPost, "/v1/shared-vaults/synthetic-vault/audit-events", "not-json", "synthetic-vault")
	if response.Code != http.StatusUnauthorized || repository.accessCalls != 0 {
		t.Fatalf("unauthorized audit response=%d persistence calls=%d", response.Code, repository.accessCalls)
	}
}

func invokeVaultAuditHandler(t *testing.T, handler httpapi.OperationHandler, method, path, body, vaultID string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	response := httptest.NewRecorder()
	ctx := echo.New().NewContext(request, response)
	ctx.SetPathValues(echo.PathValues{{Name: "vaultId", Value: vaultID}})
	if err := handler(ctx); err != nil {
		t.Fatalf("Vault audit handler returned error: %v", err)
	}
	return response
}
