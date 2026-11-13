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
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/account-deletion/application"
	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity/application"
)

const syntheticDeletionAuthorization = "synthetic-deletion-authorization-token-00000"

type otpAuthorizerStub struct {
	user     identityapp.ApplicationUser
	allowed  bool
	calls    int
	mutation string
}

func (authorizer *otpAuthorizerStub) AuthorizeApplicationUserRequest(ctx *echo.Context, mutation string) (identityapp.ApplicationUser, bool, error) {
	authorizer.calls++
	authorizer.mutation = mutation
	if !authorizer.allowed {
		_ = ctx.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthenticated"})
	}
	return authorizer.user, authorizer.allowed, nil
}

type otpRepositoryStub struct {
	challenge     application.PasswordlessOTPChallenge
	authorization string
	createError   error
	verifyError   error
	createCalls   int
	verifyCalls   int
	userID        string
	otp           string
}

func (repository *otpRepositoryStub) CreatePasswordlessOTPChallenge(_ context.Context, userID string, _ time.Time) (application.PasswordlessOTPChallenge, error) {
	repository.createCalls++
	repository.userID = userID
	return repository.challenge, repository.createError
}

func (repository *otpRepositoryStub) VerifyPasswordlessOTP(_ context.Context, userID string, otp string, _ time.Time) (string, error) {
	repository.verifyCalls++
	repository.userID = userID
	repository.otp = otp
	return repository.authorization, repository.verifyError
}

type otpEmailSenderStub struct {
	err       error
	calls     int
	recipient string
	otp       string
}

func (sender *otpEmailSenderStub) SendDeletionOTP(_ context.Context, recipient string, otp string) error {
	sender.calls++
	sender.recipient = recipient
	sender.otp = otp
	return sender.err
}

func invokeOTPHandler(t *testing.T, handler func(*echo.Context) error, method string, body string, origin string, authorization string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, "/v1/me/deletion/otp", strings.NewReader(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if origin != "" {
		request.Header.Set("Origin", origin)
	}
	if authorization != "" {
		request.Header.Set("Authorization", authorization)
	}
	response := httptest.NewRecorder()
	context := echo.New().NewContext(request, response)
	if err := handler(context); err != nil {
		t.Fatalf("OTP handler returned error: %v", err)
	}
	return response
}

func TestAccountDeletionOTPRequestSendsOnlyForFreshSameOriginPasswordlessUser(t *testing.T) {
	now := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	authorizer := &otpAuthorizerStub{user: identityapp.ApplicationUser{ID: "synthetic-user", Email: "owner@example.test"}, allowed: true}
	repository := &otpRepositoryStub{challenge: application.PasswordlessOTPChallenge{ID: "synthetic-challenge", OTP: "001234"}}
	sender := &otpEmailSenderStub{}
	handler := NewOTPHandlers(authorizer, repository, sender, "passwordless", previewWebOrigin, func() time.Time { return now }).OperationHandlers()["postMeDeletionOtpRequest"]
	response := invokeOTPHandler(t, handler, http.MethodPost, "", previewWebOrigin, "")
	if response.Code != http.StatusNoContent || response.Header().Get("Cache-Control") != "no-store" || response.Body.Len() != 0 {
		t.Fatalf("OTP request response=%d body=%q headers=%v", response.Code, response.Body.String(), response.Header())
	}
	if authorizer.calls != 1 || authorizer.mutation != "account_deletion_authentication" || repository.createCalls != 1 ||
		repository.userID != "synthetic-user" || sender.calls != 1 || sender.recipient != "owner@example.test" || sender.otp != "001234" {
		t.Fatalf("OTP request dependencies called unexpectedly: authorizer=%#v repository=%#v sender=%#v", authorizer, repository, sender)
	}
}

func TestAccountDeletionOTPRequestRejectsBrowserBackendAndDependencyFailures(t *testing.T) {
	for _, test := range []struct {
		name          string
		origin        string
		authorization string
		backend       string
		senderError   error
		wantStatus    int
		wantCode      string
	}{
		{name: "missing origin", backend: "passwordless", wantStatus: http.StatusForbidden, wantCode: "same_origin_required"},
		{name: "foreign origin", origin: "https://attacker.example.test", backend: "passwordless", wantStatus: http.StatusForbidden, wantCode: "same_origin_required"},
		{name: "authorization header", origin: previewWebOrigin, authorization: "Bearer synthetic", backend: "passwordless", wantStatus: http.StatusForbidden, wantCode: "same_origin_required"},
		{name: "unsupported backend", origin: previewWebOrigin, backend: "none", wantStatus: http.StatusConflict, wantCode: "passwordless_reauthentication_unavailable"},
		{name: "email failure", origin: previewWebOrigin, backend: "passwordless", senderError: errors.New("synthetic sender failure"), wantStatus: http.StatusServiceUnavailable, wantCode: "deletion_otp_delivery_failed"},
	} {
		t.Run(test.name, func(t *testing.T) {
			authorizer := &otpAuthorizerStub{user: identityapp.ApplicationUser{ID: "synthetic-user", Email: "owner@example.test"}, allowed: true}
			repository := &otpRepositoryStub{challenge: application.PasswordlessOTPChallenge{ID: "synthetic-challenge", OTP: "001234"}}
			sender := &otpEmailSenderStub{err: test.senderError}
			handler := NewOTPHandlers(authorizer, repository, sender, test.backend, previewWebOrigin, nil).OperationHandlers()["postMeDeletionOtpRequest"]
			response := invokeOTPHandler(t, handler, http.MethodPost, "", test.origin, test.authorization)
			if response.Code != test.wantStatus || !strings.Contains(response.Body.String(), test.wantCode) || response.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("OTP request response=%d body=%q headers=%v", response.Code, response.Body.String(), response.Header())
			}
			if test.wantCode == "same_origin_required" || test.wantCode == "passwordless_reauthentication_unavailable" {
				if authorizer.calls != 0 || repository.createCalls != 0 || sender.calls != 0 {
					t.Fatalf("rejected request reached dependencies: authorizer=%#v repository=%#v sender=%#v", authorizer, repository, sender)
				}
			}
			if strings.Contains(response.Body.String(), "001234") {
				t.Fatal("OTP request error response exposed the one-time code")
			}
		})
	}
}

func TestAccountDeletionOTPVerifySetsStrictHttpOnlyAuthorizationCookie(t *testing.T) {
	authorizer := &otpAuthorizerStub{user: identityapp.ApplicationUser{ID: "synthetic-user"}, allowed: true}
	repository := &otpRepositoryStub{authorization: syntheticDeletionAuthorization}
	handler := NewOTPHandlers(authorizer, repository, nil, "passwordless", previewWebOrigin, nil).OperationHandlers()["postMeDeletionOtpVerify"]
	response := invokeOTPHandler(t, handler, http.MethodPost, `{"otp":"001234"}`, previewWebOrigin, "")
	if response.Code != http.StatusNoContent || response.Header().Get("Cache-Control") != "no-store" || response.Body.Len() != 0 {
		t.Fatalf("OTP verify response=%d body=%q headers=%v", response.Code, response.Body.String(), response.Header())
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("authorization cookie count=%d; want 1", len(cookies))
	}
	cookie := cookies[0]
	if cookie.Name != deletionAuthorizationCookieName || cookie.Value != syntheticDeletionAuthorization || cookie.Path != "/" || cookie.MaxAge != 600 ||
		!cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteStrictMode {
		t.Fatalf("deletion authorization cookie attributes mismatch: %#v", cookie)
	}
	if authorizer.calls != 1 || authorizer.mutation != "account_deletion_authentication" || repository.verifyCalls != 1 || repository.userID != "synthetic-user" || repository.otp != "001234" {
		t.Fatalf("OTP verification dependencies called unexpectedly: authorizer=%#v repository=%#v", authorizer, repository)
	}
	if strings.Contains(response.Body.String(), syntheticDeletionAuthorization) {
		t.Fatal("authorization token appeared in response body")
	}
}

func TestAccountDeletionOTPVerifyUsesTheContractBodyLimit(t *testing.T) {
	authorizer := &otpAuthorizerStub{user: identityapp.ApplicationUser{ID: "synthetic-user"}, allowed: true}
	repository := &otpRepositoryStub{authorization: syntheticDeletionAuthorization}
	handler := NewOTPHandlers(authorizer, repository, nil, "passwordless", previewWebOrigin, nil).OperationHandlers()["postMeDeletionOtpVerify"]
	validBody := `{"otp":"001234"}`
	atLimit := validBody + strings.Repeat(" ", int(httpapi.MaxJSONBodyBytes)-len(validBody))
	response := invokeOTPHandler(t, handler, http.MethodPost, atLimit, previewWebOrigin, "")
	if response.Code != http.StatusNoContent || repository.verifyCalls != 1 {
		t.Fatalf("maximum-sized valid OTP body response=%d body=%q verifyCalls=%d", response.Code, response.Body.String(), repository.verifyCalls)
	}

	response = invokeOTPHandler(t, handler, http.MethodPost, atLimit+" ", previewWebOrigin, "")
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "invalid_deletion_otp") || repository.verifyCalls != 1 {
		t.Fatalf("oversized OTP body response=%d body=%q verifyCalls=%d", response.Code, response.Body.String(), repository.verifyCalls)
	}
}

func TestAccountDeletionOTPVerifyMapsValidationAndRepositoryErrors(t *testing.T) {
	for _, test := range []struct {
		name       string
		body       string
		repository error
		wantStatus int
		wantError  string
		wantCalls  int
	}{
		{name: "missing required OTP", body: `{}`, wantStatus: http.StatusBadRequest, wantError: "invalid_deletion_otp"},
		{name: "extra field", body: `{"otp":"001234","extra":true}`, wantStatus: http.StatusBadRequest, wantError: "invalid_deletion_otp"},
		{name: "malformed OTP", body: `{"otp":"１２３４５６"}`, wantStatus: http.StatusBadRequest, wantError: "invalid_deletion_otp"},
		{name: "invalid OTP", body: `{"otp":"001234"}`, repository: application.ErrPasswordlessOTPInvalid, wantStatus: http.StatusBadRequest, wantError: "invalid_deletion_otp", wantCalls: 1},
		{name: "expired challenge", body: `{"otp":"001234"}`, repository: application.ErrPasswordlessOTPExpired, wantStatus: http.StatusBadRequest, wantError: "invalid_deletion_otp", wantCalls: 1},
		{name: "locked challenge", body: `{"otp":"001234"}`, repository: application.ErrPasswordlessOTPLocked, wantStatus: http.StatusTooManyRequests, wantError: "deletion_otp_locked", wantCalls: 1},
		{name: "storage unavailable", body: `{"otp":"001234"}`, repository: errors.New("synthetic storage failure"), wantStatus: http.StatusServiceUnavailable, wantError: "deletion_otp_verification_failed", wantCalls: 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			authorizer := &otpAuthorizerStub{user: identityapp.ApplicationUser{ID: "synthetic-user"}, allowed: true}
			repository := &otpRepositoryStub{authorization: syntheticDeletionAuthorization, verifyError: test.repository}
			handler := NewOTPHandlers(authorizer, repository, nil, "passwordless", previewWebOrigin, nil).OperationHandlers()["postMeDeletionOtpVerify"]
			response := invokeOTPHandler(t, handler, http.MethodPost, test.body, previewWebOrigin, "")
			if response.Code != test.wantStatus || !strings.Contains(response.Body.String(), test.wantError) || response.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("OTP verification response=%d body=%q headers=%v", response.Code, response.Body.String(), response.Header())
			}
			if repository.verifyCalls != test.wantCalls {
				t.Fatalf("verify repository calls=%d; want %d", repository.verifyCalls, test.wantCalls)
			}
			if len(response.Result().Cookies()) != 0 {
				t.Fatal("failed verification set deletion authorization cookie")
			}
		})
	}
}
