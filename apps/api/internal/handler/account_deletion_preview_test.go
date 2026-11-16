package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
)

const previewWebOrigin = "https://web.example.test"

type previewAuthorizerStub struct {
	user     apiService.ApplicationUser
	allowed  bool
	err      error
	calls    int
	mutation string
}

func (authorizer *previewAuthorizerStub) AuthorizeApplicationUserRequest(ctx *echo.Context, mutation string) (apiService.ApplicationUser, bool, error) {
	authorizer.calls++
	authorizer.mutation = mutation
	if !authorizer.allowed && authorizer.err == nil {
		_ = ctx.JSON(http.StatusUnauthorized, httpapi.ApiError{Error: "unauthenticated"})
	}
	return authorizer.user, authorizer.allowed, authorizer.err
}

type previewRepositoryStub struct {
	preview apiService.Preview
	err     error
	calls   int
	userID  string
}

func (repository *previewRepositoryStub) GetPreview(_ context.Context, userID string) (apiService.Preview, error) {
	repository.calls++
	repository.userID = userID
	return repository.preview, repository.err
}

func invokePreview(t *testing.T, handler httpapi.OperationHandler, origin string, authorization string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/v1/me/deletion/preview", nil)
	if origin != "" {
		request.Header.Set("Origin", origin)
	}
	if authorization != "" {
		request.Header.Set("Authorization", authorization)
	}
	response := httptest.NewRecorder()
	context := echo.New().NewContext(request, response)
	if err := handler(context); err != nil {
		t.Fatalf("preview handler returned error: %v", err)
	}
	return response
}

func TestAccountDeletionPreviewReturnsCurrentTransferCandidatesWithoutCiphertext(t *testing.T) {
	personalVaultID := "synthetic-personal-vault"
	repository := &previewRepositoryStub{preview: apiService.Preview{
		PersonalVaultID: &personalVaultID,
		OwnedSharedVaults: []apiService.OwnedSharedVaultPreview{
			{ID: "synthetic-shared-active", Lifecycle: "ACTIVE", ViewerCandidates: []apiService.DeletionViewerCandidate{{ID: "synthetic-viewer", Email: "viewer@example.test"}}},
			{ID: "synthetic-shared-deleted", Lifecycle: "DELETED", ViewerCandidates: []apiService.DeletionViewerCandidate{}},
		},
	}}
	authorizer := &previewAuthorizerStub{user: apiService.ApplicationUser{ID: "synthetic-user", Email: "owner@example.test"}, allowed: true}
	handler := NewPreviewHandlers(authorizer, repository, previewWebOrigin).OperationHandlers()["getMeDeletionPreview"]
	response := invokePreview(t, handler, previewWebOrigin, "")
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("preview response=%d headers=%v body=%s", response.Code, response.Header(), response.Body.String())
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode preview: %v", err)
	}
	if len(payload) != 2 || string(payload["personalVaultId"]) != `"synthetic-personal-vault"` ||
		!strings.Contains(string(payload["ownedSharedVaults"]), `"viewerCandidates":[{"id":"synthetic-viewer","email":"viewer@example.test"}]`) {
		t.Fatalf("unexpected deletion preview response: %s", response.Body.String())
	}
	for _, forbidden := range []string{"encryptedVaultKey", "encryptedName", "encryptedPayload", "keyVersion", "totp"} {
		if strings.Contains(response.Body.String(), forbidden) {
			t.Fatalf("preview returned forbidden field %q: %s", forbidden, response.Body.String())
		}
	}
	if authorizer.calls != 1 || authorizer.mutation != "" || repository.calls != 1 || repository.userID != "synthetic-user" {
		t.Fatalf("preview authorization or repository call mismatch: authorizer=%#v repository=%#v", authorizer, repository)
	}
}

func TestAccountDeletionPreviewRequiresBrowserOriginAndRejectsAuthorization(t *testing.T) {
	for _, test := range []struct {
		name          string
		origin        string
		authorization string
	}{
		{name: "missing origin"},
		{name: "foreign origin", origin: "https://attacker.example.test"},
		{name: "authorization header", origin: previewWebOrigin, authorization: "Bearer synthetic"},
	} {
		t.Run(test.name, func(t *testing.T) {
			authorizer := &previewAuthorizerStub{allowed: true}
			repository := &previewRepositoryStub{}
			handler := NewPreviewHandlers(authorizer, repository, previewWebOrigin).OperationHandlers()["getMeDeletionPreview"]
			response := invokePreview(t, handler, test.origin, test.authorization)
			if response.Code != http.StatusForbidden || response.Body.String() != "{\"error\":\"browser_only\"}\n" ||
				response.Header().Get("Cache-Control") != "no-store" || authorizer.calls != 0 || repository.calls != 0 {
				t.Fatalf("browser guard response=%d body=%q headers=%v authorizer=%#v repository=%#v", response.Code, response.Body.String(), response.Header(), authorizer, repository)
			}
		})
	}
}

func TestAccountDeletionPreviewMapsUnavailableRepositoryAndAuthentication(t *testing.T) {
	repository := &previewRepositoryStub{err: errors.New("synthetic storage failure")}
	authorizer := &previewAuthorizerStub{user: apiService.ApplicationUser{ID: "synthetic-user"}, allowed: true}
	handler := NewPreviewHandlers(authorizer, repository, previewWebOrigin).OperationHandlers()["getMeDeletionPreview"]
	response := invokePreview(t, handler, previewWebOrigin, "")
	if response.Code != http.StatusServiceUnavailable || response.Body.String() != "{\"error\":\"deletion_preview_unavailable\"}\n" || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("unavailable preview response=%d %q headers=%v", response.Code, response.Body.String(), response.Header())
	}

	repository = &previewRepositoryStub{}
	authorizer = &previewAuthorizerStub{allowed: false}
	handler = NewPreviewHandlers(authorizer, repository, previewWebOrigin).OperationHandlers()["getMeDeletionPreview"]
	response = invokePreview(t, handler, previewWebOrigin, "")
	if response.Code != http.StatusUnauthorized || repository.calls != 0 || authorizer.calls != 1 {
		t.Fatalf("authentication response should be written by authorizer without reading preview: status=%d body=%q calls=%d authorizer=%d", response.Code, response.Body.String(), repository.calls, authorizer.calls)
	}
}

func TestSameOriginBrowserReadNormalizesConfiguredOriginAndRejectsNonOrigins(t *testing.T) {
	for _, test := range []struct {
		origin         string
		expectedOrigin string
		want           bool
	}{
		{origin: "https://web.example.test", expectedOrigin: previewWebOrigin, want: true},
		{origin: "HTTPS://WEB.EXAMPLE.TEST:443", expectedOrigin: previewWebOrigin, want: true},
		{origin: "https://web.example.test", expectedOrigin: "HTTPS://WEB.EXAMPLE.TEST:443/", want: true},
		{origin: "https://web.example.test/", expectedOrigin: previewWebOrigin, want: false},
		{origin: "https://web.example.test/path", expectedOrigin: previewWebOrigin, want: false},
		{origin: "https://web.example.test?query", expectedOrigin: previewWebOrigin, want: false},
		{origin: "http://web.example.test", expectedOrigin: previewWebOrigin, want: false},
		{origin: "https://web.example.test:444", expectedOrigin: previewWebOrigin, want: false},
		{origin: "not-an-origin", expectedOrigin: previewWebOrigin, want: false},
	} {
		request := httptest.NewRequest(http.MethodGet, "/", nil)
		request.Header.Set("Origin", test.origin)
		if got := isSameOriginBrowserRequest(request, test.expectedOrigin); got != test.want {
			t.Errorf("origin %q against configured %q accepted=%v; want %v", test.origin, test.expectedOrigin, got, test.want)
		}
	}
}
