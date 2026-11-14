package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/localization"
	apiRepository "github.com/nooroctavian/rhasia-scret/apps/api/internal/repository"
	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
)

const (
	passwordlessAccessCookie    = apiService.PasswordlessAccessCookie
	passwordlessRefreshCookie   = apiService.PasswordlessRefreshCookie
	passwordlessAssertionCookie = apiService.PasswordlessAssertionCookie
	authReturnPathCookie        = apiService.AuthReturnPathCookie
	e2eSessionCookie            = "rhsia-e2e-session"
)

type PasswordlessService interface {
	RequestLink(context.Context, struct {
		Email           string
		Client          apiService.PasswordlessClient
		ReturnPath      apiService.PasswordlessReturnPath
		Locale          localization.Locale
		TurnstileToken  string
		HandoffID       string
		HandoffVerifier string
	}) error
	Redeem(context.Context, string, apiService.PasswordlessClient) (*apiService.PasswordlessSession, apiService.PasswordlessReturnPath, error)
	VerifyAccessToken(context.Context, string) (*apiService.Principal, error)
	VerifyBrowserSession(context.Context, string) (*apiService.Principal, error)
	Revoke(context.Context, string, string) error
	PublishPWAHandoff(context.Context, string, string) error
	RedeemPWAHandoff(context.Context, string, string) (*apiService.PasswordlessSession, apiService.PasswordlessReturnPath, error)
	SignBrowserAssertion(string, time.Time) (string, error)
}

type AnonymousAuthRateLimiter interface {
	Check(context.Context, string, string, time.Time) (apiRepository.AnonymousAuthRateLimitResult, error)
}

type TurnstileValidator interface {
	ValidateWithDiagnostics(context.Context, string) (apiService.TurnstileValidationDiagnostics, error)
}

type IdentityDependencies struct {
	WebOrigin                  string
	Backend                    apiService.AuthBackend
	Passwordless               PasswordlessService
	Configuration              *apiService.PasswordlessConfiguration
	SessionVerifier            apiService.SessionVerifier
	Authenticator              apiService.Authenticator
	CryptoProfiles             UserCryptoProfileService
	EncryptionIdentity         UserEncryptionIdentityService
	EncryptionIdentityRotation UserEncryptionIdentityRotationService
	PasskeyRecovery            apiService.PasskeyRecoveryRepository
	PasskeyRecoveryWebAuthn    *webauthn.WebAuthn
	AnonymousRateLimiter       AnonymousAuthRateLimiter
	Turnstile                  TurnstileValidator
	Logger                     httpapi.APIEventLogger
	NodeEnvironment            string
	E2EBrowserTests            string
	Now                        func() time.Time
}

type IdentityHandlers struct {
	dependencies IdentityDependencies
}

func NewIdentityHandlers(dependencies IdentityDependencies) *IdentityHandlers {
	if dependencies.Now == nil {
		dependencies.Now = time.Now
	}
	return &IdentityHandlers{dependencies: dependencies}
}

func (handlers *IdentityHandlers) OperationHandlers() map[string]httpapi.OperationHandler {
	return map[string]httpapi.OperationHandler{
		"postAuthMagiclinkRequest":                 handlers.requestMagicLink,
		"postAuthMagiclinkRedeem":                  handlers.redeemMagicLink,
		"postAuthPwaSession":                       handlers.pwaSession,
		"postAuthSessionRefresh":                   handlers.refreshSession,
		"postAuthSessionRevoke":                    handlers.revokeSession,
		"getMe":                                    handlers.getCurrentUser,
		"postPasskeyrecoveryRegistrationOptions":   handlers.passkeyRecoveryRegistrationOptions,
		"postPasskeyrecoveryRegistrationVerify":    handlers.passkeyRecoveryRegistrationVerify,
		"postPasskeyrecoveryAuthenticationOptions": handlers.passkeyRecoveryAuthenticationOptions,
		"postPasskeyrecoveryAuthenticationVerify":  handlers.passkeyRecoveryAuthenticationVerify,
		"getPasskeyrecoveryStatus":                 handlers.passkeyRecoveryStatus,
		"deletePasskeyrecovery":                    handlers.passkeyRecoveryRemove,
		"getUsercryptoprofile":                     handlers.getUserCryptoProfile,
		"postUsercryptoprofileRewrap":              handlers.rewrapUserRootKey,
		"postUsercryptoprofileMigration":           handlers.migrateUserCryptoProfile,
		"putUserencryptionidentity":                handlers.putUserEncryptionIdentity,
		"postUserencryptionidentityMigration":      handlers.migrateUserEncryptionPrivateKey,
		"getUserencryptionidentityRotation":        handlers.getUserEncryptionIdentityRotation,
		"patchUserencryptionidentityRotation":      handlers.patchUserEncryptionIdentityRotation,
	}
}

type optionalString struct {
	Value string
	Set   bool
}

func (value *optionalString) UnmarshalJSON(raw []byte) error {
	if string(raw) == "null" {
		return errors.New("optional string cannot be null")
	}
	if err := json.Unmarshal(raw, &value.Value); err != nil {
		return err
	}
	value.Set = true
	return nil
}

type magicLinkRequest struct {
	Client          string         `json:"client"`
	Email           string         `json:"email"`
	ReturnPath      string         `json:"returnPath"`
	TurnstileToken  optionalString `json:"turnstileToken"`
	HandoffID       optionalString `json:"handoffId"`
	HandoffVerifier optionalString `json:"handoffVerifier"`
}

func (handlers *IdentityHandlers) getCurrentUser(ctx *echo.Context) error {
	user, authorized, err := handlers.authorizeApplicationRequest(ctx, "")
	if err != nil || !authorized {
		return err
	}
	return ctx.JSON(http.StatusOK, map[string]string{"id": user.ID, "email": user.Email})
}

func (handlers *IdentityHandlers) requestMagicLink(ctx *echo.Context) error {
	request := ctx.Request()
	body, err := httpapi.DecodeJSONBody[magicLinkRequest](request, httpapi.MaxJSONBodyBytes)
	if err != nil || !validMagicLinkRequest(body) {
		return writeAPIError(ctx, http.StatusBadRequest, "invalid_request")
	}
	if !isClientOriginAllowed(request, handlers.dependencies.WebOrigin) {
		return ctx.NoContent(http.StatusForbidden)
	}
	if handlers.dependencies.Turnstile == nil {
		return handlers.turnstileUnavailable(ctx, body.Client, "factory_error", nil, 0)
	}
	turnstileToken := ""
	if body.TurnstileToken.Set {
		turnstileToken = body.TurnstileToken.Value
	}
	turnstileStartedAt := time.Now()
	turnstileDiagnostics, err := handlers.dependencies.Turnstile.ValidateWithDiagnostics(request.Context(), turnstileToken)
	if err != nil || turnstileDiagnostics.Result == apiService.TurnstileUnavailable {
		reason := turnstileDiagnostics.UnavailableReason
		if err != nil {
			reason = "factory_error"
		}
		return handlers.turnstileUnavailable(ctx, body.Client, reason, turnstileDiagnostics.ResponseStatus, time.Since(turnstileStartedAt).Milliseconds())
	}
	if turnstileDiagnostics.Result != apiService.TurnstileValid {
		return writeAPIError(ctx, http.StatusForbidden, "turnstile_failed")
	}
	if handlers.dependencies.AnonymousRateLimiter == nil {
		return handlers.rateLimitUnavailable(ctx, body.Client, nil)
	}
	email := strings.ToLower(strings.TrimSpace(body.Email))
	clientIP := requestClientIP(request, httpapi.IsProxyRequest(ctx))
	startedAt := time.Now()
	limit, err := handlers.dependencies.AnonymousRateLimiter.Check(request.Context(), email, clientIP, handlers.dependencies.Now())
	if err != nil {
		return handlers.rateLimitUnavailable(ctx, body.Client, err)
	}
	if !limit.Allowed {
		ctx.Response().Header().Set("Retry-After", strconvItoa(limit.RetryAfterSeconds))
		return writeAPIError(ctx, http.StatusTooManyRequests, "rate_limited")
	}
	if handlers.dependencies.Passwordless == nil {
		return handlers.emailDeliveryFailed(ctx, body.Client, errors.New("passwordless authentication is disabled"), startedAt)
	}
	input := struct {
		Email           string
		Client          apiService.PasswordlessClient
		ReturnPath      apiService.PasswordlessReturnPath
		Locale          localization.Locale
		TurnstileToken  string
		HandoffID       string
		HandoffVerifier string
	}{
		Email:          strings.TrimSpace(body.Email),
		Client:         apiService.PasswordlessClient(body.Client),
		ReturnPath:     apiService.PasswordlessReturnPath(body.ReturnPath),
		Locale:         httpapi.RequestLocale(request),
		TurnstileToken: turnstileToken,
	}
	if body.Client == string(apiService.PasswordlessClientPWA) {
		input.HandoffID = body.HandoffID.Value
		input.HandoffVerifier = body.HandoffVerifier.Value
	}
	if err := handlers.dependencies.Passwordless.RequestLink(request.Context(), input); err != nil {
		return handlers.emailDeliveryFailed(ctx, body.Client, err, startedAt)
	}
	return ctx.JSON(http.StatusOK, map[string]bool{"sent": true})
}

type magicLinkRedeemRequest struct {
	Token  string `json:"token"`
	Client string `json:"client"`
}

func (handlers *IdentityHandlers) redeemMagicLink(ctx *echo.Context) error {
	body, err := httpapi.DecodeJSONBody[magicLinkRedeemRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || utf16Length(body.Token) < 1 || utf16Length(body.Token) > 128 || body.Client != "web" && body.Client != "pwa" {
		return writeAPIError(ctx, http.StatusBadRequest, "invalid_request")
	}
	if !isClientOriginAllowed(ctx.Request(), handlers.dependencies.WebOrigin) {
		return ctx.NoContent(http.StatusForbidden)
	}
	if handlers.dependencies.Configuration == nil || handlers.dependencies.Passwordless == nil {
		return writeAPIError(ctx, http.StatusBadRequest, "redemption_failed")
	}
	session, returnPath, err := handlers.dependencies.Passwordless.Redeem(ctx.Request().Context(), body.Token, apiService.PasswordlessClient(body.Client))
	if err != nil {
		return writeAPIError(ctx, http.StatusBadRequest, "redemption_failed")
	}
	if session == nil {
		return writeAPIError(ctx, http.StatusBadRequest, "link_expired")
	}
	if body.Client == string(apiService.PasswordlessClientPWA) {
		return ctx.JSON(http.StatusOK, map[string]string{
			"refreshToken": session.RefreshToken,
			"returnPath":   string(returnPath),
		})
	}
	if err := handlers.setPasswordlessSessionCookies(ctx, *session); err != nil {
		return err
	}
	appendCookie(ctx, authReturnPathCookie, "", false, 0)
	return ctx.JSON(http.StatusOK, map[string]string{"returnPath": string(returnPath)})
}

type pwaSessionRequest struct {
	HandoffID    string         `json:"handoffId"`
	RefreshToken optionalString `json:"refreshToken"`
	Verifier     optionalString `json:"verifier"`
}

func (handlers *IdentityHandlers) pwaSession(ctx *echo.Context) error {
	body, err := httpapi.DecodeJSONBody[pwaSessionRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || !isSafeURLToken(body.HandoffID, 16, 128) {
		return writeAPIError(ctx, http.StatusBadRequest, "invalid_request")
	}
	publishing := body.RefreshToken.Set && !body.Verifier.Set && utf16Length(body.RefreshToken.Value) >= 1 && utf16Length(body.RefreshToken.Value) <= 257
	redeeming := !body.RefreshToken.Set && body.Verifier.Set && isSafeURLToken(body.Verifier.Value, 43, 128)
	if !publishing && !redeeming {
		return writeAPIError(ctx, http.StatusBadRequest, "invalid_request")
	}
	if !isSameOrigin(ctx.Request(), handlers.dependencies.WebOrigin) {
		return ctx.NoContent(http.StatusForbidden)
	}
	if publishing {
		if handlers.dependencies.Passwordless != nil {
			if err := handlers.dependencies.Passwordless.PublishPWAHandoff(ctx.Request().Context(), body.RefreshToken.Value, body.HandoffID); err != nil {
				return writeAPIError(ctx, http.StatusUnauthorized, "handoff_failed")
			}
		}
		return ctx.JSON(http.StatusOK, map[string]bool{"published": true})
	}
	if handlers.dependencies.Passwordless == nil {
		return ctx.JSON(http.StatusAccepted, map[string]bool{"pending": true})
	}
	session, returnPath, err := handlers.dependencies.Passwordless.RedeemPWAHandoff(ctx.Request().Context(), body.HandoffID, body.Verifier.Value)
	if err != nil {
		return writeAPIError(ctx, http.StatusUnauthorized, "handoff_failed")
	}
	if session == nil {
		return ctx.JSON(http.StatusAccepted, map[string]bool{"pending": true})
	}
	if handlers.dependencies.Configuration == nil {
		return writeAPIError(ctx, http.StatusUnauthorized, "handoff_failed")
	}
	if err := handlers.setPasswordlessSessionCookies(ctx, *session); err != nil {
		return writeAPIError(ctx, http.StatusUnauthorized, "handoff_failed")
	}
	appendCookie(ctx, authReturnPathCookie, "", false, 0)
	return ctx.JSON(http.StatusOK, map[string]any{"accepted": true, "returnPath": string(returnPath)})
}

type refreshSessionRequest struct {
	Client string `json:"client"`
}

func (handlers *IdentityHandlers) refreshSession(ctx *echo.Context) error {
	body, err := httpapi.DecodeJSONBody[refreshSessionRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || body.Client != "web" {
		return writeAPIError(ctx, http.StatusBadRequest, "invalid_request")
	}
	if !isClientOriginAllowed(ctx.Request(), handlers.dependencies.WebOrigin) {
		return ctx.NoContent(http.StatusForbidden)
	}
	if len(ctx.Request().Header.Values("Authorization")) != 0 {
		return writeAPIError(ctx, http.StatusBadRequest, "invalid_request")
	}
	if handlers.dependencies.SessionVerifier == nil {
		return handlers.expireSession(ctx)
	}
	principal, err := handlers.dependencies.SessionVerifier.Verify(ctx.Request().Context(), apiService.SessionCredentials{
		AuthorizationPresent: false,
		CookieHeader:         ctx.Request().Header.Get("Cookie"),
		TrustedProxy:         httpapi.IsProxyRequest(ctx),
	}, apiService.AssuranceActiveSession)
	if err != nil {
		return err
	}
	if principal == nil || !apiService.AssuranceSatisfies(principal.Assurance, apiService.AssuranceActiveSession) {
		return handlers.expireSession(ctx)
	}
	if principal.Issuer == apiService.PasswordlessIssuer && principal.SessionID != "" && !principal.SessionExpiresAt.IsZero() {
		if handlers.dependencies.Passwordless == nil {
			return errors.New("passwordless browser assertion signer is unavailable")
		}
		assertion, err := handlers.dependencies.Passwordless.SignBrowserAssertion(principal.SessionID, principal.SessionExpiresAt)
		if err != nil {
			return err
		}
		now := handlers.dependencies.Now()
		maximumExpiry := now.Add(apiService.PasswordlessAssertionMaxAgeSeconds * time.Second)
		maxAge := cookieMaxAge(minTime(principal.SessionExpiresAt, maximumExpiry), now)
		appendCookie(ctx, passwordlessAssertionCookie, assertion, true, maxAge)
	}
	return ctx.JSON(http.StatusOK, map[string]bool{"refreshed": true})
}

func (handlers *IdentityHandlers) expireSession(ctx *echo.Context) error {
	clearIdentityPasswordlessSessionCookies(ctx)
	return writeAPIError(ctx, http.StatusUnauthorized, "session_expired")
}

func (handlers *IdentityHandlers) revokeSession(ctx *echo.Context) error {
	request := ctx.Request()
	if len(request.Header.Values("Authorization")) != 0 {
		return writeAPIError(ctx, http.StatusBadRequest, "invalid_request")
	}
	if request.Header.Get("Cookie") != "" && !httpapi.IsProxyRequest(ctx) {
		return ctx.NoContent(http.StatusForbidden)
	}
	if !isSameOriginIfPresent(request, handlers.dependencies.WebOrigin) {
		return ctx.NoContent(http.StatusForbidden)
	}
	if handlers.dependencies.NodeEnvironment == "development" && handlers.dependencies.E2EBrowserTests == "1" {
		appendCookie(ctx, e2eSessionCookie, "", true, 0)
	}
	if handlers.dependencies.Passwordless != nil {
		cookies := parseCookies(request.Header.Get("Cookie"))
		if refreshToken := cookies[passwordlessRefreshCookie]; refreshToken != "" {
			sessionID, _, _ := strings.Cut(refreshToken, ".")
			if sessionID != "" {
				_ = handlers.dependencies.Passwordless.Revoke(request.Context(), sessionID, "logout")
			}
		} else if accessToken := cookies[passwordlessAccessCookie]; accessToken != "" {
			principal, err := handlers.dependencies.Passwordless.VerifyAccessToken(request.Context(), accessToken)
			if err == nil && principal != nil && principal.SessionID != "" {
				_ = handlers.dependencies.Passwordless.Revoke(request.Context(), principal.SessionID, "logout")
			}
		}
	}
	clearIdentityPasswordlessSessionCookies(ctx)
	appendCookie(ctx, passwordlessAssertionCookie, "", true, 0)
	return ctx.NoContent(http.StatusNoContent)
}

func (handlers *IdentityHandlers) setPasswordlessSessionCookies(ctx *echo.Context, session apiService.PasswordlessSession) error {
	if handlers.dependencies.Configuration == nil || handlers.dependencies.Passwordless == nil {
		return errors.New("passwordless cookie configuration is unavailable")
	}
	now := handlers.dependencies.Now()
	assertion, err := handlers.dependencies.Passwordless.SignBrowserAssertion(session.SessionID, session.RefreshExpiresAt)
	if err != nil {
		return err
	}
	appendCookie(ctx, passwordlessAccessCookie, session.AccessToken, true, cookieMaxAge(session.AccessExpiresAt, now))
	appendCookie(ctx, passwordlessRefreshCookie, session.RefreshToken, true, cookieMaxAge(session.RefreshExpiresAt, now))
	appendCookie(ctx, passwordlessAssertionCookie, assertion, true, cookieMaxAge(minTime(session.RefreshExpiresAt, now.Add(apiService.PasswordlessAssertionMaxAgeSeconds*time.Second)), now))
	return nil
}

func (handlers *IdentityHandlers) turnstileUnavailable(ctx *echo.Context, client string, reason apiService.TurnstileUnavailableReason, responseStatus *int, durationMs int64) error {
	fields := map[string]any{
		"dependency": "turnstile",
		"client":     client,
		"durationMs": durationMs,
		"reason":     string(reason),
	}
	if responseStatus != nil {
		fields["providerStatus"] = *responseStatus
	}
	handlers.log(ctx, "error", "magic_link_request_turnstile_unavailable", fields)
	ctx.Response().Header().Set("Retry-After", "5")
	return writeAPIError(ctx, http.StatusServiceUnavailable, "turnstile_unavailable")
}

func (handlers *IdentityHandlers) rateLimitUnavailable(ctx *echo.Context, client string, cause error) error {
	handlers.log(ctx, "error", "magic_link_request_rate_limit_unavailable", map[string]any{
		"dependency": "anonymous_auth_rate_limiter",
		"client":     client,
		"reason":     safeErrorCategory(cause),
	})
	ctx.Response().Header().Set("Retry-After", "5")
	return writeAPIError(ctx, http.StatusServiceUnavailable, "rate_limit_unavailable")
}

func (handlers *IdentityHandlers) emailDeliveryFailed(ctx *echo.Context, client string, cause error, startedAt time.Time) error {
	event := "magic_link_request_failed"
	dependency := "passwordless_authentication"
	errorType := "dependency_error"
	var persistenceError *apiService.PasswordlessChallengePersistenceError
	var deliveryError *apiService.PasswordlessEmailDeliveryError
	if errors.As(cause, &persistenceError) {
		event = "magic_link_request_challenge_persistence_failed"
		dependency = "passwordless_challenge_database"
		errorType = "PasswordlessChallengePersistenceError"
	} else if errors.As(cause, &deliveryError) {
		event = "magic_link_request_delivery_failed"
		dependency = "smtp_email_delivery"
		errorType = "PasswordlessEmailDeliveryError"
	}
	handlers.log(ctx, "error", event, map[string]any{
		"dependency": dependency,
		"client":     client,
		"durationMs": time.Since(startedAt).Milliseconds(),
		"errorType":  errorType,
	})
	return writeAPIError(ctx, http.StatusServiceUnavailable, "email_delivery_failed")
}

func (handlers *IdentityHandlers) log(ctx *echo.Context, level string, event string, fields map[string]any) {
	if handlers.dependencies.Logger == nil {
		return
	}
	fields["requestId"] = httpapi.RequestID(ctx)
	handlers.dependencies.Logger.Log(level, event, fields)
}

func safeErrorCategory(err error) string {
	if err == nil {
		return "dependency_unavailable"
	}
	return "dependency_error"
}

func writeAPIError(ctx *echo.Context, status int, code string) error {
	return ctx.JSON(status, httpapi.ApiError{Error: code})
}

func appendCookie(ctx *echo.Context, name string, value string, httpOnly bool, maxAge int) {
	cookie := url.QueryEscape(name) + "=" + url.QueryEscape(value) + "; Max-Age=" + strconvItoa(maxAge) + "; Path=/"
	if httpOnly {
		cookie += "; HttpOnly"
	}
	cookie += "; Secure; SameSite=Lax"
	ctx.Response().Header().Add("Set-Cookie", cookie)
}

func clearIdentityPasswordlessSessionCookies(ctx *echo.Context) {
	for _, name := range []string{passwordlessAccessCookie, passwordlessRefreshCookie, passwordlessAssertionCookie} {
		appendCookie(ctx, name, "", true, 0)
	}
}

func cookieMaxAge(expiresAt time.Time, now time.Time) int {
	seconds := int(expiresAt.Sub(now).Seconds())
	if seconds < 1 {
		return 1
	}
	return seconds
}

func minTime(left time.Time, right time.Time) time.Time {
	if left.Before(right) {
		return left
	}
	return right
}

func validMagicLinkRequest(body magicLinkRequest) bool {
	if body.Client != string(apiService.PasswordlessClientWeb) && body.Client != string(apiService.PasswordlessClientPWA) {
		return false
	}
	email := strings.TrimSpace(body.Email)
	if utf16Length(email) < 1 || utf16Length(email) > 254 || !isEmail(email) {
		return false
	}
	if body.ReturnPath != string(apiService.PasswordlessReturnPathVaults) && body.ReturnPath != string(apiService.PasswordlessReturnPathInvitationRedeem) {
		return false
	}
	if body.TurnstileToken.Set && !apiService.IsSafeTurnstileToken(body.TurnstileToken.Value) {
		return false
	}
	if body.Client == string(apiService.PasswordlessClientWeb) {
		return !body.HandoffID.Set && !body.HandoffVerifier.Set
	}
	return body.HandoffID.Set && body.HandoffVerifier.Set && isSafeURLToken(body.HandoffID.Value, 16, 128) && isSafeURLToken(body.HandoffVerifier.Value, 43, 128)
}

func isEmail(value string) bool {
	return apiService.IsValidPasswordlessEmail(value)
}

func isSafeURLToken(value string, minimum int, maximum int) bool {
	length := utf16Length(value)
	if length < minimum || length > maximum {
		return false
	}
	for _, character := range value {
		if !(character >= 'A' && character <= 'Z') && !(character >= 'a' && character <= 'z') && !(character >= '0' && character <= '9') && character != '_' && character != '-' {
			return false
		}
	}
	return true
}

func isClientOriginAllowed(request *http.Request, webOrigin string) bool {
	return isSameOrigin(request, webOrigin)
}

func isSameOrigin(request *http.Request, webOrigin string) bool {
	origins := request.Header.Values("Origin")
	if len(origins) != 1 || origins[0] == "" {
		return false
	}
	origin, ok := httpapi.NormalizeOrigin(origins[0])
	if !ok {
		return false
	}
	if webOrigin != "" {
		expected, validExpected := httpapi.NormalizeConfiguredOrigin(webOrigin)
		return validExpected && origin == expected
	}
	expected := requestPublicOrigin(request)
	return expected != "" && origin == expected
}

func isSameOriginIfPresent(request *http.Request, webOrigin string) bool {
	origins := request.Header.Values("Origin")
	if len(origins) == 0 {
		return true
	}
	return isSameOrigin(request, webOrigin)
}

func requestPublicOrigin(request *http.Request) string {
	if request.URL.IsAbs() && request.URL.Host != "" {
		origin, ok := httpapi.NormalizeOrigin(request.URL.Scheme + "://" + request.URL.Host)
		if ok {
			return origin
		}
	}
	scheme := "http"
	if request.TLS != nil {
		scheme = "https"
	} else if forwarded := request.Header.Values("X-Forwarded-Proto"); len(forwarded) == 1 && (forwarded[0] == "http" || forwarded[0] == "https") {
		scheme = forwarded[0]
	}
	host := request.Host
	if host == "" {
		host = request.URL.Host
	}
	origin, ok := httpapi.NormalizeOrigin(scheme + "://" + host)
	if !ok {
		return ""
	}
	return origin
}

func requestClientIP(request *http.Request, trustedProxy bool) string {
	if !trustedProxy {
		return ""
	}
	forwarded := strings.TrimSpace(request.Header.Get("X-Rhasia-Client-Ip"))
	if forwarded == "" || utf16Length(forwarded) > 128 {
		return ""
	}
	return forwarded
}

func parseCookies(header string) map[string]string {
	cookies := make(map[string]string)
	for _, pair := range strings.Split(header, ";") {
		name, value, found := strings.Cut(pair, "=")
		if !found || strings.TrimSpace(name) == "" {
			continue
		}
		cookies[strings.TrimSpace(name)] = strings.TrimSpace(value)
	}
	return cookies
}

func utf16Length(value string) int {
	return len(utf16.Encode([]rune(value)))
}

func strconvItoa(value int) string {
	return strconv.Itoa(value)
}

var _ apiService.SessionVerifier = (*apiRepository.SessionVerifier)(nil)
