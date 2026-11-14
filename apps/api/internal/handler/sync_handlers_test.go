package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v5"

	apiEntity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
)

type syncAuthorizerStub struct {
	user       apiService.ApplicationUser
	authorized bool
	calls      int
	mutations  []string
}

func (authorizer *syncAuthorizerStub) AuthorizeApplicationUserRequest(ctx *echo.Context, mutation string) (apiService.ApplicationUser, bool, error) {
	authorizer.calls++
	authorizer.mutations = append(authorizer.mutations, mutation)
	if !authorizer.authorized {
		return apiService.ApplicationUser{}, false, ctx.JSON(http.StatusUnauthorized, httpapi.ApiError{Error: "unauthenticated"})
	}
	return authorizer.user, true, nil
}

type syncReaderStub struct {
	bundle         *apiEntity.EncryptedOnlineWorkspaceBundle
	response       *apiEntity.AuthorizedWorkspaceResponse
	bundleErr      error
	responseErr    error
	bundleCalls    int
	responseCalls  int
	bundleUserID   string
	responseUserID string
}

func (reader *syncReaderStub) ReadOnlineWorkspaceBundle(_ context.Context, userID string) (*apiEntity.EncryptedOnlineWorkspaceBundle, error) {
	reader.bundleCalls++
	reader.bundleUserID = userID
	return reader.bundle, reader.bundleErr
}

func (reader *syncReaderStub) ReadAuthorizedWorkspaceResponse(_ context.Context, userID string) (*apiEntity.AuthorizedWorkspaceResponse, error) {
	reader.responseCalls++
	reader.responseUserID = userID
	return reader.response, reader.responseErr
}

func TestOfflineBundleReturnsFreshAuthorizedSnapshotAndExactETagRevalidation(t *testing.T) {
	bundle := &apiEntity.EncryptedOnlineWorkspaceBundle{
		SchemaVersion: 2, ProfileID: "synthetic-user", SynchronizedAt: "2026-08-01T02:03:04.005Z",
		SynchronizationToken: "synthetic-token", CryptoProfile: apiEntity.EncryptedOfflineCryptoProfile{
			VaultUnlockSalt: "c2FsdA==", WrappedUserRootKey: "c2VhbGVk", EncryptedPersonalVaultKey: "c2VhbGVk", EncryptionVersion: 1,
		}, PersonalVault: apiEntity.EncryptedOfflinePersonalVault{
			VaultID: "synthetic-personal-vault", Lifecycle: "ACTIVE", EncryptedName: "c2VhbGVk", EncryptionVersion: 1,
			Accounts: []apiEntity.EncryptedOfflineAccount{},
		}, SharedVaults: []apiEntity.EncryptedOnlineSharedVault{},
	}
	authorizer := &syncAuthorizerStub{user: apiService.ApplicationUser{ID: "synthetic-user", Status: "ACTIVE"}, authorized: true}
	reader := &syncReaderStub{bundle: bundle}
	handler := NewSyncHandlers(authorizer, reader).OperationHandlers()["getSyncOfflinebundle"]
	response := invokeSyncHandler(t, handler, http.MethodGet, "/v1/sync/offline-bundle", nil)
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != workspaceCacheControl ||
		response.Header().Get("ETag") != `"synthetic-token"` || response.Header().Get("X-Synchronized-At") != bundle.SynchronizedAt ||
		authorizer.calls != 1 || authorizer.mutations[0] != "" || reader.bundleCalls != 1 || reader.bundleUserID != "synthetic-user" {
		t.Fatalf("offline bundle response=%d headers=%v auth=%#v reader=%#v body=%s", response.Code, response.Header(), authorizer, reader, response.Body.String())
	}
	reader.bundleCalls = 0
	requestHeaders := http.Header{"If-None-Match": []string{`"synthetic-token"`}}
	response = invokeSyncHandler(t, handler, http.MethodGet, "/v1/sync/offline-bundle", requestHeaders)
	if response.Code != http.StatusNotModified || response.Body.Len() != 0 || reader.bundleCalls != 1 || authorizer.calls != 2 ||
		response.Header().Get("Cache-Control") != workspaceCacheControl || response.Header().Get("ETag") != `"synthetic-token"` ||
		response.Header().Get("X-Synchronized-At") != bundle.SynchronizedAt {
		t.Fatalf("conditional offline response=%d headers=%v auth calls=%d reader calls=%d body=%s", response.Code, response.Header(), authorizer.calls, reader.bundleCalls, response.Body.String())
	}
}

func TestOfflineBundleOnlyUsesExactIfNoneMatchValueAfterReadingSnapshot(t *testing.T) {
	bundle := &apiEntity.EncryptedOnlineWorkspaceBundle{SynchronizationToken: "etag", SynchronizedAt: "2026-08-01T00:00:00.000Z"}
	reader := &syncReaderStub{bundle: bundle}
	handler := NewSyncHandlers(&syncAuthorizerStub{user: apiService.ApplicationUser{ID: "synthetic-user"}, authorized: true}, reader).OperationHandlers()["getSyncOfflinebundle"]
	for _, value := range []string{`W/"etag"`, `"other", "etag"`, `*`} {
		reader.bundleCalls = 0
		response := invokeSyncHandler(t, handler, http.MethodGet, "/v1/sync/offline-bundle", http.Header{"If-None-Match": []string{value}})
		if response.Code != http.StatusOK || reader.bundleCalls != 1 {
			t.Errorf("If-None-Match %q returned %d after %d reads", value, response.Code, reader.bundleCalls)
		}
	}
	reader.bundleCalls = 0
	response := invokeSyncHandler(t, handler, http.MethodGet, "/v1/sync/offline-bundle", http.Header{"If-None-Match": []string{`"etag"`, `"etag"`}})
	if response.Code != http.StatusOK || reader.bundleCalls != 1 {
		t.Fatalf("duplicate If-None-Match returned %d after %d reads", response.Code, reader.bundleCalls)
	}
}

func TestWorkspaceBundleIsAlwaysFullNoStoreResponseAndOmitsETag(t *testing.T) {
	now := time.Date(2026, time.August, 1, 2, 3, 4, 0, time.UTC)
	responseBody := &apiEntity.AuthorizedWorkspaceResponse{
		ResponseVersion: 1, WorkspaceSynchronizationToken: "synthetic-workspace-token",
		SynchronizedAt: now.Format("2006-01-02T15:04:05.000Z"),
		PersonalSnapshot: apiEntity.EncryptedPersonalOfflineSnapshot{
			SchemaVersion: 3, ProfileID: "synthetic-user", SynchronizedAt: now.Format("2006-01-02T15:04:05.000Z"),
			SynchronizationToken: "synthetic-personal-token", CryptoProfile: apiEntity.EncryptedOfflineCryptoProfile{
				VaultUnlockSalt: "c2FsdA==", WrappedUserRootKey: "c2VhbGVk", EncryptedPersonalVaultKey: "c2VhbGVk", EncryptionVersion: 1,
			}, PersonalVault: apiEntity.EncryptedOfflinePersonalVault{
				VaultID: "synthetic-personal-vault", Lifecycle: "ACTIVE", EncryptedName: "c2VhbGVk", EncryptionVersion: 1,
				Accounts: []apiEntity.EncryptedOfflineAccount{},
			},
		}, SharedVaults: []apiEntity.EncryptedOnlineSharedVault{},
	}
	authorizer := &syncAuthorizerStub{user: apiService.ApplicationUser{ID: "synthetic-user"}, authorized: true}
	reader := &syncReaderStub{response: responseBody}
	handler := NewSyncHandlers(authorizer, reader).OperationHandlers()["getSyncWorkspacebundle"]
	response := invokeSyncHandler(t, handler, http.MethodGet, "/v1/sync/workspace-bundle", http.Header{"If-None-Match": []string{`"synthetic-workspace-token"`}})
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != workspaceCacheControl ||
		response.Header().Get("ETag") != "" || response.Header().Get("X-Synchronized-At") != responseBody.SynchronizedAt ||
		reader.responseCalls != 1 || reader.responseUserID != "synthetic-user" || authorizer.calls != 1 {
		t.Fatalf("workspace bundle response=%d headers=%v auth=%#v reader=%#v body=%s", response.Code, response.Header(), authorizer, reader, response.Body.String())
	}
}

func TestSyncBundleHandlersFailClosedOnMissingAuthAndReportNotInitialized(t *testing.T) {
	reader := &syncReaderStub{}
	unauthorized := &syncAuthorizerStub{}
	handlers := NewSyncHandlers(unauthorized, reader).OperationHandlers()
	response := invokeSyncHandler(t, handlers["getSyncOfflinebundle"], http.MethodGet, "/v1/sync/offline-bundle", nil)
	if response.Code != http.StatusUnauthorized || reader.bundleCalls != 0 {
		t.Fatalf("unauthenticated offline response=%d reads=%d", response.Code, reader.bundleCalls)
	}
	authorizer := &syncAuthorizerStub{user: apiService.ApplicationUser{ID: "synthetic-user"}, authorized: true}
	handlers = NewSyncHandlers(authorizer, reader).OperationHandlers()
	response = invokeSyncHandler(t, handlers["getSyncOfflinebundle"], http.MethodGet, "/v1/sync/offline-bundle", nil)
	if response.Code != http.StatusNotFound || !strings.Contains(response.Body.String(), "not_initialized") || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("uninitialized offline response=%d headers=%v %s", response.Code, response.Header(), response.Body.String())
	}
	response = invokeSyncHandler(t, handlers["getSyncWorkspacebundle"], http.MethodGet, "/v1/sync/workspace-bundle", nil)
	if response.Code != http.StatusNotFound || !strings.Contains(response.Body.String(), "not_initialized") || reader.responseCalls != 1 {
		t.Fatalf("uninitialized workspace response=%d reads=%d %s", response.Code, reader.responseCalls, response.Body.String())
	}
	reader.responseErr = errors.New("synthetic repository error")
	if err := NewSyncHandlers(authorizer, reader).OperationHandlers()["getSyncWorkspacebundle"](echo.New().NewContext(
		httptest.NewRequest(http.MethodGet, "/v1/sync/workspace-bundle", nil), httptest.NewRecorder())); err == nil {
		t.Fatal("workspace repository error was hidden")
	}
}

func invokeSyncHandler(t *testing.T, handler httpapi.OperationHandler, method, path string, headers http.Header) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, path, nil)
	if headers != nil {
		request.Header = headers
	}
	response := httptest.NewRecorder()
	ctx := echo.New().NewContext(request, response)
	if err := handler(ctx); err != nil {
		t.Fatalf("sync handler returned error: %v", err)
	}
	return response
}
