package http

import (
	"errors"
	"net/http"
	"net/url"
	"time"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/account-deletion/application"
)

const deletionAuthorizationCookieName = "rhsia-account-deletion-authorization"

type OTPHandlers struct {
	authorizer ApplicationUserAuthorizer
	repository application.PasswordlessOTPRepository
	sender     application.PasswordlessOTPEmailSender
	backend    string
	webOrigin  string
	now        func() time.Time
}

func NewOTPHandlers(authorizer ApplicationUserAuthorizer, repository application.PasswordlessOTPRepository, sender application.PasswordlessOTPEmailSender, backend string, webOrigin string, now func() time.Time) *OTPHandlers {
	if now == nil {
		now = time.Now
	}
	return &OTPHandlers{authorizer: authorizer, repository: repository, sender: sender, backend: backend, webOrigin: webOrigin, now: now}
}

func (handlers *OTPHandlers) OperationHandlers() map[string]httpapi.OperationHandler {
	return map[string]httpapi.OperationHandler{
		"postMeDeletionOtpRequest": handlers.requestOTP,
		"postMeDeletionOtpVerify":  handlers.verifyOTP,
	}
}

func (handlers *OTPHandlers) requestOTP(ctx *echo.Context) error {
	ctx.Response().Header().Set(echo.HeaderCacheControl, "no-store")
	if !isSameOriginBrowserRequest(ctx.Request(), handlers.webOrigin) {
		return writeOTPError(ctx, http.StatusForbidden, "same_origin_required")
	}
	if handlers.backend != "passwordless" {
		return writeOTPError(ctx, http.StatusConflict, "passwordless_reauthentication_unavailable")
	}
	if handlers.authorizer == nil {
		return writeOTPError(ctx, http.StatusServiceUnavailable, "deletion_otp_delivery_failed")
	}
	user, authorized, err := handlers.authorizer.AuthorizeApplicationUserRequest(ctx, "account_deletion_authentication")
	if err != nil || !authorized {
		return err
	}
	if handlers.repository == nil || handlers.sender == nil {
		return writeOTPError(ctx, http.StatusServiceUnavailable, "deletion_otp_delivery_failed")
	}
	challenge, err := handlers.repository.CreatePasswordlessOTPChallenge(ctx.Request().Context(), user.ID, handlers.now())
	if err != nil {
		return writeOTPError(ctx, http.StatusServiceUnavailable, "deletion_otp_delivery_failed")
	}
	if err := handlers.sender.SendDeletionOTP(ctx.Request().Context(), user.Email, challenge.OTP, httpapi.RequestLocale(ctx.Request())); err != nil {
		return writeOTPError(ctx, http.StatusServiceUnavailable, "deletion_otp_delivery_failed")
	}
	return ctx.NoContent(http.StatusNoContent)
}

func (handlers *OTPHandlers) verifyOTP(ctx *echo.Context) error {
	ctx.Response().Header().Set(echo.HeaderCacheControl, "no-store")
	if !isSameOriginBrowserRequest(ctx.Request(), handlers.webOrigin) {
		return writeOTPError(ctx, http.StatusForbidden, "same_origin_required")
	}
	if handlers.authorizer == nil {
		return writeOTPError(ctx, http.StatusServiceUnavailable, "deletion_otp_verification_failed")
	}
	user, authorized, err := handlers.authorizer.AuthorizeApplicationUserRequest(ctx, "account_deletion_authentication")
	if err != nil || !authorized {
		return err
	}
	body, err := httpapi.DecodeJSONBody[verifyDeletionOTPRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || !application.ValidPasswordlessOTP(body.OTP) {
		return writeOTPError(ctx, http.StatusBadRequest, "invalid_deletion_otp")
	}
	if handlers.repository == nil {
		return writeOTPError(ctx, http.StatusServiceUnavailable, "deletion_otp_verification_failed")
	}
	authorizationToken, err := handlers.repository.VerifyPasswordlessOTP(ctx.Request().Context(), user.ID, body.OTP, handlers.now())
	if err != nil {
		if errors.Is(err, application.ErrPasswordlessOTPLocked) {
			return writeOTPError(ctx, http.StatusTooManyRequests, "deletion_otp_locked")
		}
		if errors.Is(err, application.ErrPasswordlessOTPInvalid) || errors.Is(err, application.ErrPasswordlessOTPExpired) {
			return writeOTPError(ctx, http.StatusBadRequest, "invalid_deletion_otp")
		}
		return writeOTPError(ctx, http.StatusServiceUnavailable, "deletion_otp_verification_failed")
	}
	ctx.SetCookie(&http.Cookie{
		Name:     deletionAuthorizationCookieName,
		Value:    url.QueryEscape(authorizationToken),
		Path:     "/",
		MaxAge:   int(application.DeletionAuthorizationLifetime.Seconds()),
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	})
	return ctx.NoContent(http.StatusNoContent)
}

type verifyDeletionOTPRequest struct {
	OTP string `json:"otp"`
}

func writeOTPError(ctx *echo.Context, status int, code string) error {
	return ctx.JSON(status, httpapi.ApiError{Error: code})
}
