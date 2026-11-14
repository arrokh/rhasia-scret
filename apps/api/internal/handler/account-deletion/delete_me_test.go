package http

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/localization"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/service/account-deletion"
	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/identity"
)

type deletionRepositoryStub struct {
	completed      *application.DeletionResult
	findError      error
	deleteResult   application.DeletionResult
	deleteError    error
	emailStatusErr error
	findCalls      int
	deleteCalls    int
	statusCalls    []string
	userID         string
	authorization  string
	request        application.DeletionRequest
}

func (repository *deletionRepositoryStub) FindCompletedDeletion(_ context.Context, token string) (*application.DeletionResult, error) {
	repository.findCalls++
	repository.authorization = token
	return repository.completed, repository.findError
}

func (repository *deletionRepositoryStub) DeleteUser(_ context.Context, userID string, token string, request application.DeletionRequest, _ time.Time) (application.DeletionResult, error) {
	repository.deleteCalls++
	repository.userID = userID
	repository.authorization = token
	repository.request = request
	return repository.deleteResult, repository.deleteError
}

func (repository *deletionRepositoryStub) RecordCompletionEmailStatus(_ context.Context, _ string, status string) error {
	repository.statusCalls = append(repository.statusCalls, status)
	return repository.emailStatusErr
}

type completionEmailSenderStub struct {
	err       error
	calls     int
	recipient string
	receiptID string
	locale    localization.Locale
}

func (sender *completionEmailSenderStub) SendDeletionCompletion(_ context.Context, recipient string, receiptID string, locale localization.Locale) error {
	sender.calls++
	sender.recipient = recipient
	sender.receiptID = receiptID
	sender.locale = locale
	return sender.err
}

func invokeDeleteMe(t *testing.T, handler httpapi.OperationHandler, body string, origin string, authorization string, cookie string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodDelete, "/v1/me", strings.NewReader(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if origin != "" {
		request.Header.Set("Origin", origin)
	}
	if authorization != "" {
		request.Header.Set("Authorization", authorization)
	}
	if cookie != "" {
		request.Header.Set("Cookie", cookie)
	}
	response := httptest.NewRecorder()
	context := echo.New().NewContext(request, response)
	if err := handler(context); err != nil {
		t.Fatalf("DELETE /me handler returned error: %v", err)
	}
	return response
}

func TestDeleteMeReturnsCompletedReceiptBeforeAuthenticationAndBodyParsing(t *testing.T) {
	repository := &deletionRepositoryStub{completed: &application.DeletionResult{ReceiptID: "synthetic-receipt-0001", EmailDelivery: "sent"}}
	authorizer := &otpAuthorizerStub{allowed: false}
	sender := &completionEmailSenderStub{}
	handler := NewDeleteMeHandlers(authorizer, repository, sender, previewWebOrigin, nil).OperationHandlers()["deleteMe"]
	response := invokeDeleteMe(t, handler, "not-json", previewWebOrigin, "", deletionAuthorizationCookieName+"="+syntheticDeletionAuthorization)
	if response.Code != http.StatusOK || response.Body.String() != "{\"receiptId\":\"synthetic-receipt-0001\",\"emailDelivery\":\"sent\"}\n" || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("idempotent deletion response=%d body=%q headers=%v", response.Code, response.Body.String(), response.Header())
	}
	if repository.findCalls != 1 || repository.deleteCalls != 0 || authorizer.calls != 0 || sender.calls != 0 {
		t.Fatalf("completed receipt did not bypass authentication/body/deletion: repository=%#v authorizer=%#v sender=%#v", repository, authorizer, sender)
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 4 {
		t.Fatalf("idempotent response cookie count=%d cookies=%#v", len(cookies), cookies)
	}
	clearedCookies := make(map[string]bool, len(cookies))
	for _, cookie := range cookies {
		if cookie.MaxAge >= 0 {
			t.Fatalf("idempotent response did not expire cookie: %#v", cookie)
		}
		clearedCookies[cookie.Name] = true
	}
	for _, name := range []string{
		identityapp.PasswordlessAccessCookie,
		identityapp.PasswordlessRefreshCookie,
		identityapp.PasswordlessAssertionCookie,
		deletionAuthorizationCookieName,
	} {
		if !clearedCookies[name] {
			t.Errorf("idempotent response did not clear %q: %#v", name, cookies)
		}
	}
}

func TestDeleteMeReceiptLookupFailureUsesSharedInternalErrorPath(t *testing.T) {
	repository := &deletionRepositoryStub{findError: errors.New("synthetic repository detail")}
	authorizer := &otpAuthorizerStub{allowed: true}
	handler := NewDeleteMeHandlers(authorizer, repository, &completionEmailSenderStub{}, previewWebOrigin, nil).OperationHandlers()["deleteMe"]
	request := httptest.NewRequest(http.MethodDelete, "/v1/me", nil)
	request.Header.Set("Origin", previewWebOrigin)
	request.AddCookie(&http.Cookie{Name: deletionAuthorizationCookieName, Value: syntheticDeletionAuthorization})
	response := httptest.NewRecorder()
	context := echo.New().NewContext(request, response)
	if err := handler(context); !errors.Is(err, repository.findError) {
		t.Fatalf("receipt lookup failure should reach the shared generic error mapper: %v", err)
	}
	if response.Body.Len() != 0 || authorizer.calls != 0 || repository.deleteCalls != 0 {
		t.Fatalf("receipt lookup failure continued deletion or wrote a response: body=%q authorizer=%#v repository=%#v", response.Body.String(), authorizer, repository)
	}
}

func TestDeleteMeRequiresBrowserOriginAndValidAuthorizationCookie(t *testing.T) {
	for _, test := range []struct {
		name          string
		origin        string
		authorization string
		cookie        string
		wantStatus    int
		wantError     string
	}{
		{name: "foreign origin", origin: "https://attacker.example.test", cookie: deletionAuthorizationCookieName + "=" + syntheticDeletionAuthorization, wantStatus: http.StatusForbidden, wantError: "same_origin_required"},
		{name: "bearer authorization", origin: previewWebOrigin, authorization: "Bearer synthetic", cookie: deletionAuthorizationCookieName + "=" + syntheticDeletionAuthorization, wantStatus: http.StatusForbidden, wantError: "same_origin_required"},
		{name: "missing cookie", origin: previewWebOrigin, wantStatus: http.StatusUnauthorized, wantError: "deletion_reauthentication_required"},
		{name: "malformed cookie", origin: previewWebOrigin, cookie: deletionAuthorizationCookieName + "=short", wantStatus: http.StatusUnauthorized, wantError: "deletion_reauthentication_required"},
	} {
		t.Run(test.name, func(t *testing.T) {
			repository := &deletionRepositoryStub{}
			authorizer := &otpAuthorizerStub{allowed: true}
			handler := NewDeleteMeHandlers(authorizer, repository, &completionEmailSenderStub{}, previewWebOrigin, nil).OperationHandlers()["deleteMe"]
			response := invokeDeleteMe(t, handler, `{}`, test.origin, test.authorization, test.cookie)
			if response.Code != test.wantStatus || !strings.Contains(response.Body.String(), test.wantError) || repository.findCalls != 0 || repository.deleteCalls != 0 || authorizer.calls != 0 {
				t.Fatalf("browser/authorization guard response=%d %q repository=%#v authorizer=%#v", response.Code, response.Body.String(), repository, authorizer)
			}
		})
	}
}

func TestDeleteMeDeletesAccountPersistsEmailDeliveryAndClearsCookies(t *testing.T) {
	now := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	authorizer := &otpAuthorizerStub{user: identityapp.ApplicationUser{ID: "synthetic-user-00001", Email: "owner@example.test"}, allowed: true}
	repository := &deletionRepositoryStub{deleteResult: application.DeletionResult{ReceiptID: "synthetic-receipt-0001", Email: "owner@example.test"}}
	sender := &completionEmailSenderStub{}
	handler := NewDeleteMeHandlers(authorizer, repository, sender, previewWebOrigin, func() time.Time { return now }).OperationHandlers()["deleteMe"]
	body := `{"confirmation":"HAPUS AKUN","acknowledged":true,"vaultDecisions":[]}`
	response := invokeDeleteMe(t, handler, body, previewWebOrigin, "", deletionAuthorizationCookieName+"="+syntheticDeletionAuthorization+"; "+localization.CookieName+"="+string(localization.English))
	if response.Code != http.StatusOK || response.Body.String() != "{\"receiptId\":\"synthetic-receipt-0001\",\"emailDelivery\":\"sent\"}\n" || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("delete response=%d body=%q headers=%v", response.Code, response.Body.String(), response.Header())
	}
	if authorizer.calls != 1 || authorizer.mutation != "destructive_mutation" || repository.findCalls != 1 || repository.deleteCalls != 1 ||
		repository.userID != "synthetic-user-00001" || repository.authorization != syntheticDeletionAuthorization || repository.request.Confirmation != application.DeletionConfirmation ||
		sender.calls != 1 || sender.recipient != "owner@example.test" || sender.receiptID != "synthetic-receipt-0001" || sender.locale != localization.English || strings.Join(repository.statusCalls, ",") != "SENT" {
		t.Fatalf("deletion flow dependencies mismatch: authorizer=%#v repository=%#v sender=%#v", authorizer, repository, sender)
	}
	cookieNames := make(map[string]struct{})
	for _, cookie := range response.Result().Cookies() {
		if cookie.MaxAge < 0 {
			cookieNames[cookie.Name] = struct{}{}
		}
	}
	for _, name := range []string{deletionAuthorizationCookieName, identityapp.PasswordlessAccessCookie, identityapp.PasswordlessRefreshCookie, identityapp.PasswordlessAssertionCookie} {
		if _, found := cookieNames[name]; !found {
			t.Errorf("successful deletion did not expire cookie %q", name)
		}
	}
}

func TestDeleteMeEmailFailureDoesNotUndoCommittedDeletion(t *testing.T) {
	repository := &deletionRepositoryStub{deleteResult: application.DeletionResult{ReceiptID: "synthetic-receipt-0001", Email: "owner@example.test"}}
	sender := &completionEmailSenderStub{err: errors.New("synthetic SMTP failure")}
	handler := NewDeleteMeHandlers(&otpAuthorizerStub{user: identityapp.ApplicationUser{ID: "synthetic-user-00001"}, allowed: true}, repository, sender, previewWebOrigin, nil).OperationHandlers()["deleteMe"]
	response := invokeDeleteMe(t, handler, `{"confirmation":"HAPUS AKUN","acknowledged":true,"vaultDecisions":[]}`, previewWebOrigin, "", deletionAuthorizationCookieName+"="+syntheticDeletionAuthorization)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"emailDelivery":"failed"`) || strings.Join(repository.statusCalls, ",") != "FAILED" {
		t.Fatalf("email failure changed deletion result: status=%d body=%q emailStatuses=%v", response.Code, response.Body.String(), repository.statusCalls)
	}
}

func TestDeleteMeMapsValidationAuthorizationAndStalePlanFailures(t *testing.T) {
	for _, test := range []struct {
		name       string
		body       string
		deleteErr  error
		wantStatus int
		wantError  string
	}{
		{name: "invalid json", body: `{"confirmation":`, wantStatus: http.StatusBadRequest, wantError: "invalid_deletion_request"},
		{name: "missing required confirmation", body: `{"acknowledged":true,"vaultDecisions":[]}`, wantStatus: http.StatusBadRequest, wantError: "invalid_deletion_request"},
		{name: "wrong confirmation", body: `{"confirmation":"wrong","acknowledged":true,"vaultDecisions":[]}`, wantStatus: http.StatusBadRequest, wantError: "invalid_confirmation"},
		{name: "missing acknowledgement", body: `{"confirmation":"HAPUS AKUN","acknowledged":false,"vaultDecisions":[]}`, wantStatus: http.StatusBadRequest, wantError: "acknowledgement_required"},
		{name: "missing required decisions", body: `{"confirmation":"HAPUS AKUN","acknowledged":true}`, wantStatus: http.StatusBadRequest, wantError: "invalid_deletion_request"},
		{name: "malformed vault ID", body: `{"confirmation":"HAPUS AKUN","acknowledged":true,"vaultDecisions":[{"vaultId":"short","action":"DELETE"}]}`, wantStatus: http.StatusBadRequest, wantError: "invalid_deletion_request"},
		{name: "invalid action enum", body: `{"confirmation":"HAPUS AKUN","acknowledged":true,"vaultDecisions":[{"vaultId":"synthetic-vault-0001","action":"MOVE"}]}`, wantStatus: http.StatusBadRequest, wantError: "invalid_deletion_request"},
		{name: "null transfer target", body: `{"confirmation":"HAPUS AKUN","acknowledged":true,"vaultDecisions":[{"vaultId":"synthetic-vault-0001","action":"TRANSFER","transferToUserId":null}]}`, wantStatus: http.StatusBadRequest, wantError: "invalid_deletion_request"},
		{name: "unknown field", body: `{"confirmation":"HAPUS AKUN","acknowledged":true,"vaultDecisions":[],"extra":true}`, wantStatus: http.StatusBadRequest, wantError: "invalid_deletion_request"},
		{name: "stale plan", body: `{"confirmation":"HAPUS AKUN","acknowledged":true,"vaultDecisions":[]}`, deleteErr: application.ErrDeletionPlanStale, wantStatus: http.StatusConflict, wantError: "deletion_plan_stale"},
		{name: "expired authorization", body: `{"confirmation":"HAPUS AKUN","acknowledged":true,"vaultDecisions":[]}`, deleteErr: application.ErrDeletionAuthorization, wantStatus: http.StatusUnauthorized, wantError: "deletion_reauthentication_required"},
	} {
		t.Run(test.name, func(t *testing.T) {
			repository := &deletionRepositoryStub{deleteResult: application.DeletionResult{}, deleteError: test.deleteErr}
			authorizer := &otpAuthorizerStub{user: identityapp.ApplicationUser{ID: "synthetic-user-00001"}, allowed: true}
			handler := NewDeleteMeHandlers(authorizer, repository, &completionEmailSenderStub{}, previewWebOrigin, nil).OperationHandlers()["deleteMe"]
			response := invokeDeleteMe(t, handler, test.body, previewWebOrigin, "", deletionAuthorizationCookieName+"="+syntheticDeletionAuthorization)
			if response.Code != test.wantStatus || !strings.Contains(response.Body.String(), test.wantError) || response.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("DELETE /me failure response=%d body=%q headers=%v", response.Code, response.Body.String(), response.Header())
			}
			if test.deleteErr == nil && repository.deleteCalls != 0 {
				t.Fatalf("invalid request reached repository: calls=%d", repository.deleteCalls)
			}
		})
	}
}
