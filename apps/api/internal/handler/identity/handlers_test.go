package http

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v5"

	identityinfra "github.com/nooroctavian/rhasia-scret/apps/api/internal/adapter/identity"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/localization"
	identityrepository "github.com/nooroctavian/rhasia-scret/apps/api/internal/repository/identity"
	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/identity"
)

const testWebOrigin = "https://web.example.test"

var testNow = time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)

type fakePasswordlessService struct {
	requestInput *struct {
		Email           string
		Client          identityapp.PasswordlessClient
		ReturnPath      identityapp.PasswordlessReturnPath
		Locale          localization.Locale
		TurnstileToken  string
		HandoffID       string
		HandoffVerifier string
	}
	requestError         error
	redeemSession        *identityapp.PasswordlessSession
	redeemPath           identityapp.PasswordlessReturnPath
	redeemError          error
	accessPrincipal      *identityapp.Principal
	accessError          error
	revokeCalls          []string
	revokeError          error
	publishError         error
	redeemHandoffSession *identityapp.PasswordlessSession
	redeemHandoffPath    identityapp.PasswordlessReturnPath
	redeemHandoffError   error
	signedAssertion      string
	signError            error
}

func (service *fakePasswordlessService) RequestLink(_ context.Context, input struct {
	Email           string
	Client          identityapp.PasswordlessClient
	ReturnPath      identityapp.PasswordlessReturnPath
	Locale          localization.Locale
	TurnstileToken  string
	HandoffID       string
	HandoffVerifier string
}) error {
	service.requestInput = &struct {
		Email           string
		Client          identityapp.PasswordlessClient
		ReturnPath      identityapp.PasswordlessReturnPath
		Locale          localization.Locale
		TurnstileToken  string
		HandoffID       string
		HandoffVerifier string
	}{input.Email, input.Client, input.ReturnPath, input.Locale, input.TurnstileToken, input.HandoffID, input.HandoffVerifier}
	return service.requestError
}

func (service *fakePasswordlessService) Redeem(context.Context, string, identityapp.PasswordlessClient) (*identityapp.PasswordlessSession, identityapp.PasswordlessReturnPath, error) {
	return service.redeemSession, service.redeemPath, service.redeemError
}

func (service *fakePasswordlessService) VerifyAccessToken(context.Context, string) (*identityapp.Principal, error) {
	return service.accessPrincipal, service.accessError
}

func (*fakePasswordlessService) VerifyBrowserSession(context.Context, string) (*identityapp.Principal, error) {
	return nil, nil
}

func (service *fakePasswordlessService) Revoke(_ context.Context, sessionID string, _ string) error {
	service.revokeCalls = append(service.revokeCalls, sessionID)
	return service.revokeError
}

func (service *fakePasswordlessService) PublishPWAHandoff(context.Context, string, string) error {
	return service.publishError
}

func (service *fakePasswordlessService) RedeemPWAHandoff(context.Context, string, string) (*identityapp.PasswordlessSession, identityapp.PasswordlessReturnPath, error) {
	return service.redeemHandoffSession, service.redeemHandoffPath, service.redeemHandoffError
}

func (service *fakePasswordlessService) SignBrowserAssertion(string, time.Time) (string, error) {
	if service.signError != nil {
		return "", service.signError
	}
	return service.signedAssertion, nil
}

type fakeAnonymousLimiter struct {
	result   identityrepository.AnonymousAuthRateLimitResult
	err      error
	calls    int
	email    string
	clientIP string
}

func (limiter *fakeAnonymousLimiter) Check(_ context.Context, email string, clientIP string, _ time.Time) (identityrepository.AnonymousAuthRateLimitResult, error) {
	limiter.calls++
	limiter.email = email
	limiter.clientIP = clientIP
	return limiter.result, limiter.err
}

type fakeTurnstile struct {
	outcome identityinfra.TurnstileOutcome
	err     error
	calls   int
	token   string
}

func (validator *fakeTurnstile) ValidateWithDiagnostics(_ context.Context, token string) (identityinfra.TurnstileValidationDiagnostics, error) {
	validator.calls++
	validator.token = token
	diagnostics := identityinfra.TurnstileValidationDiagnostics{Result: validator.outcome}
	if validator.outcome == identityinfra.TurnstileUnavailable {
		diagnostics.UnavailableReason = "transport"
	}
	return diagnostics, validator.err
}

type fakeSessionVerifier struct {
	principal *identityapp.Principal
	err       error
	calls     int
	minimum   identityapp.SessionAssurance
	trusted   bool
}

func (verifier *fakeSessionVerifier) Verify(_ context.Context, credentials identityapp.SessionCredentials, minimum identityapp.SessionAssurance) (*identityapp.Principal, error) {
	verifier.calls++
	verifier.minimum = minimum
	verifier.trusted = credentials.TrustedProxy
	if credentials.AuthorizationPresent {
		return nil, errors.New("authorization header should have been rejected by route")
	}
	return verifier.principal, verifier.err
}

type fakeLogger struct {
	events []string
	fields []map[string]any
}

func (logger *fakeLogger) Log(_ string, event string, fields map[string]any) {
	logger.events = append(logger.events, event)
	copied := make(map[string]any, len(fields))
	for key, value := range fields {
		copied[key] = value
	}
	logger.fields = append(logger.fields, copied)
}

func invokeHandler(t *testing.T, handler httpapi.OperationHandler, method string, path string, body string, headers http.Header, trustedProxy bool) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	for key, values := range headers {
		for _, value := range values {
			request.Header.Add(key, value)
		}
	}
	response := httptest.NewRecorder()
	engine := echo.New()
	ctx := engine.NewContext(request, response)
	ctx.Set("proxyRequest", trustedProxy)
	ctx.Set("requestId", "0123456789abcdef")
	if err := handler(ctx); err != nil {
		t.Fatalf("handler returned error: %v", err)
	}
	return response
}

func defaultDependencies() Dependencies {
	configuration := &identityapp.PasswordlessConfiguration{
		AppOrigin:              mustURL("https://auth.example.test"),
		MagicLinkSecret:        []byte(strings.Repeat("m", 32)),
		SessionSecret:          []byte(strings.Repeat("s", 32)),
		MagicLinkTTLSeconds:    900,
		AccessTokenTTLSeconds:  900,
		RefreshTokenTTLSeconds: 2_592_000,
	}
	return Dependencies{
		WebOrigin:            testWebOrigin,
		Configuration:        configuration,
		Passwordless:         &fakePasswordlessService{signedAssertion: "signed-assertion"},
		AnonymousRateLimiter: &fakeAnonymousLimiter{result: identityrepository.AnonymousAuthRateLimitResult{Allowed: true}},
		Turnstile:            &fakeTurnstile{outcome: identityinfra.TurnstileValid},
		Now:                  func() time.Time { return testNow },
	}
}

func mustURL(raw string) *url.URL {
	parsed, err := url.Parse(raw)
	if err != nil {
		panic(err)
	}
	return parsed
}

func requestHeaders(origin string) http.Header {
	headers := make(http.Header)
	if origin != "" {
		headers.Set("Origin", origin)
	}
	return headers
}

func TestSameOriginNormalizesConfiguredWebOriginButRejectsNonOrigins(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		origin string
		want   bool
	}{
		{origin: "https://web.example.test", want: true},
		{origin: "HTTPS://WEB.EXAMPLE.TEST:443", want: true},
		{origin: "https://web.example.test/", want: false},
		{origin: "https://web.example.test/path", want: false},
		{origin: "https://web.example.test?query", want: false},
	} {
		request := httptest.NewRequest(http.MethodPost, "/v1/auth/session/refresh", nil)
		request.Header.Set("Origin", test.origin)
		if got := isSameOrigin(request, "HTTPS://WEB.EXAMPLE.TEST:443/"); got != test.want {
			t.Errorf("same-origin check for %q = %v; want %v", test.origin, got, test.want)
		}
	}
}

func TestGetCurrentUserReturnsFreshlyAuthenticatedIdentity(t *testing.T) {
	dependencies, limiter, verifier := authenticatedCryptoProfileDependencies(&cryptoProfileServiceStub{})
	handler := NewHandlers(dependencies).OperationHandlers()["getMe"]
	response := invokeHandler(t, handler, http.MethodGet, "/v1/me", "", requestHeaders(testWebOrigin), true)
	if response.Code != http.StatusOK {
		t.Fatalf("GET /me status=%d body=%s", response.Code, response.Body.String())
	}
	var payload map[string]string
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil || len(payload) != 2 ||
		payload["id"] != "synthetic-user" || payload["email"] != "person@example.test" {
		t.Fatalf("GET /me response=%#v (%v)", payload, err)
	}
	if verifier.minimum != identityapp.AssuranceFreshProvider || limiter.calls != 0 {
		t.Fatalf("GET /me assurance=%q mutation-limiter-calls=%d", verifier.minimum, limiter.calls)
	}

	verifier.principal = nil
	response = invokeHandler(t, handler, http.MethodGet, "/v1/me", "", requestHeaders(testWebOrigin), true)
	if response.Code != http.StatusUnauthorized || limiter.calls != 0 {
		t.Fatalf("unauthenticated GET /me response=%d body=%q limiter-calls=%d", response.Code, response.Body.String(), limiter.calls)
	}
}

func TestMagicLinkRequestValidationAndOriginGuard(t *testing.T) {
	handlers := NewHandlers(defaultDependencies())
	requestHandler := handlers.OperationHandlers()["postAuthMagiclinkRequest"]

	invalid := invokeHandler(t, requestHandler, http.MethodPost, "/v1/auth/magic-link/request", `{"client":"web","email":"person@example.test","returnPath":"/vaults","unknown":true}`, requestHeaders(testWebOrigin), false)
	if invalid.Code != http.StatusBadRequest || !strings.Contains(invalid.Body.String(), `"error":"invalid_request"`) {
		t.Fatalf("invalid body response = %d %s", invalid.Code, invalid.Body.String())
	}
	if dependencies := handlers.dependencies; dependencies.Turnstile.(*fakeTurnstile).calls != 0 {
		t.Fatal("invalid request reached Turnstile")
	}
	malformedEmail := invokeHandler(t, requestHandler, http.MethodPost, "/v1/auth/magic-link/request", `{"client":"web","email":"dummy@example..test","returnPath":"/vaults"}`, requestHeaders(testWebOrigin), false)
	if malformedEmail.Code != http.StatusBadRequest || handlers.dependencies.Turnstile.(*fakeTurnstile).calls != 0 {
		t.Fatalf("malformed email response=%d body=%s turnstileCalls=%d", malformedEmail.Code, malformedEmail.Body.String(), handlers.dependencies.Turnstile.(*fakeTurnstile).calls)
	}

	disallowedHeaders := requestHeaders("https://attacker.example.test")
	disallowed := invokeHandler(t, requestHandler, http.MethodPost, "/v1/auth/magic-link/request", `{"client":"web","email":"person@example.test","returnPath":"/vaults"}`, disallowedHeaders, false)
	if disallowed.Code != http.StatusForbidden || disallowed.Body.Len() != 0 {
		t.Fatalf("disallowed origin response = %d %q", disallowed.Code, disallowed.Body.String())
	}
	if handlers.dependencies.Turnstile.(*fakeTurnstile).calls != 0 {
		t.Fatal("disallowed origin reached Turnstile")
	}
}

func TestMagicLinkRequestAppliesTurnstileAndAnonymousRateLimits(t *testing.T) {
	body := `{"client":"web","email":" Person@Example.test ","returnPath":"/vaults/invitations/redeem","turnstileToken":"synthetic-turnstile-token"}`
	requestHandler := NewHandlers(defaultDependencies()).OperationHandlers()["postAuthMagiclinkRequest"]

	invalidTurnstileDependencies := defaultDependencies()
	invalidTurnstileDependencies.Turnstile = &fakeTurnstile{outcome: identityinfra.TurnstileInvalid}
	invalidTurnstile := invokeHandler(t, NewHandlers(invalidTurnstileDependencies).OperationHandlers()["postAuthMagiclinkRequest"], http.MethodPost, "/v1/auth/magic-link/request", body, requestHeaders(testWebOrigin), false)
	if invalidTurnstile.Code != http.StatusForbidden || !strings.Contains(invalidTurnstile.Body.String(), "turnstile_failed") {
		t.Fatalf("invalid Turnstile response = %d %s", invalidTurnstile.Code, invalidTurnstile.Body.String())
	}

	unavailableDependencies := defaultDependencies()
	unavailableDependencies.Turnstile = &fakeTurnstile{outcome: identityinfra.TurnstileUnavailable}
	unavailable := invokeHandler(t, NewHandlers(unavailableDependencies).OperationHandlers()["postAuthMagiclinkRequest"], http.MethodPost, "/v1/auth/magic-link/request", body, requestHeaders(testWebOrigin), false)
	if unavailable.Code != http.StatusServiceUnavailable || unavailable.Header().Get("Retry-After") != "5" {
		t.Fatalf("unavailable Turnstile response = %d headers=%v", unavailable.Code, unavailable.Header())
	}

	limitedDependencies := defaultDependencies()
	limitedDependencies.AnonymousRateLimiter = &fakeAnonymousLimiter{result: identityrepository.AnonymousAuthRateLimitResult{Allowed: false, RetryAfterSeconds: 123}}
	limited := invokeHandler(t, NewHandlers(limitedDependencies).OperationHandlers()["postAuthMagiclinkRequest"], http.MethodPost, "/v1/auth/magic-link/request", body, requestHeaders(testWebOrigin), false)
	if limited.Code != http.StatusTooManyRequests || limited.Header().Get("Retry-After") != "123" {
		t.Fatalf("rate-limited response = %d headers=%v", limited.Code, limited.Header())
	}

	limiterFailure := defaultDependencies()
	limiterFailure.AnonymousRateLimiter = &fakeAnonymousLimiter{err: errors.New("synthetic database failure")}
	logger := &fakeLogger{}
	limiterFailure.Logger = logger
	unavailableLimit := invokeHandler(t, NewHandlers(limiterFailure).OperationHandlers()["postAuthMagiclinkRequest"], http.MethodPost, "/v1/auth/magic-link/request", body, requestHeaders(testWebOrigin), false)
	if unavailableLimit.Code != http.StatusServiceUnavailable || unavailableLimit.Header().Get("Retry-After") != "5" || !strings.Contains(unavailableLimit.Body.String(), "rate_limit_unavailable") {
		t.Fatalf("limiter failure response = %d headers=%v body=%s", unavailableLimit.Code, unavailableLimit.Header(), unavailableLimit.Body.String())
	}
	if strings.Contains(strings.Join(logger.events, " ")+strings.Join([]string{stringMapValue(logger.fields, "reason")}, " "), "database failure") {
		t.Fatal("rate-limit error details leaked to event logs")
	}

	dependencies := defaultDependencies()
	dependencies.Turnstile = &fakeTurnstile{outcome: identityinfra.TurnstileValid}
	dependencies.AnonymousRateLimiter = &fakeAnonymousLimiter{result: identityrepository.AnonymousAuthRateLimitResult{Allowed: true}}
	service := &fakePasswordlessService{signedAssertion: "signed-assertion"}
	dependencies.Passwordless = service
	logger = &fakeLogger{}
	dependencies.Logger = logger
	headers := requestHeaders(testWebOrigin)
	headers.Set("Cookie", "RHSIA_LOCALE=en")
	response := invokeHandler(t, NewHandlers(dependencies).OperationHandlers()["postAuthMagiclinkRequest"], http.MethodPost, "/v1/auth/magic-link/request", body, headers, true)
	if response.Code != http.StatusOK || response.Body.String() != "{\"sent\":true}\n" {
		t.Fatalf("successful request response = %d %q", response.Code, response.Body.String())
	}
	if dependencies.AnonymousRateLimiter.(*fakeAnonymousLimiter).email != "person@example.test" || dependencies.AnonymousRateLimiter.(*fakeAnonymousLimiter).clientIP != "" {
		t.Fatal("untrusted client IP or non-normalized email reached limiter")
	}
	if service.requestInput == nil || service.requestInput.Email != "Person@Example.test" || service.requestInput.ReturnPath != identityapp.PasswordlessReturnPathInvitationRedeem || service.requestInput.Locale != localization.English {
		t.Fatalf("unexpected service request: %#v", service.requestInput)
	}
	if strings.Contains(response.Body.String(), "turnstile") || strings.Contains(response.Body.String(), "person@example.test") {
		t.Fatal("response disclosed sensitive request values")
	}
	_ = requestHandler
}

func TestMagicLinkRequestUsesTrustedForwardedIPAndHandoffData(t *testing.T) {
	dependencies := defaultDependencies()
	limiter := &fakeAnonymousLimiter{result: identityrepository.AnonymousAuthRateLimitResult{Allowed: true}}
	dependencies.AnonymousRateLimiter = limiter
	service := &fakePasswordlessService{}
	dependencies.Passwordless = service
	headers := requestHeaders(testWebOrigin)
	headers.Set("X-Rhasia-Client-Ip", " 203.0.113.7 ")
	body := `{"client":"pwa","email":"person@example.test","returnPath":"/vaults","handoffId":"abcdefghijklmnop","handoffVerifier":"abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK","turnstileToken":"synthetic-turnstile-token"}`
	response := invokeHandler(t, NewHandlers(dependencies).OperationHandlers()["postAuthMagiclinkRequest"], http.MethodPost, "/v1/auth/magic-link/request", body, headers, true)
	if response.Code != http.StatusOK || limiter.clientIP != "203.0.113.7" {
		t.Fatalf("PWA request status=%d clientIP=%q", response.Code, limiter.clientIP)
	}
	if service.requestInput == nil || service.requestInput.HandoffID != "abcdefghijklmnop" || service.requestInput.HandoffVerifier == "" {
		t.Fatalf("PWA handoff was not forwarded: %#v", service.requestInput)
	}
}

func TestMagicLinkRedemptionSetsWebCookiesAndKeepsPWATokenInResponse(t *testing.T) {
	session := identityapp.PasswordlessSession{
		SessionID:        "0123456789abcdef0123456789abcdef",
		AccessToken:      "0123456789abcdef0123456789abcdef." + strings.Repeat("a", 43),
		RefreshToken:     "0123456789abcdef0123456789abcdef." + strings.Repeat("b", 43),
		AccessExpiresAt:  testNow.Add(15 * time.Minute),
		RefreshExpiresAt: testNow.Add(24 * time.Hour),
	}
	service := &fakePasswordlessService{redeemSession: &session, redeemPath: identityapp.PasswordlessReturnPathVaults}
	dependencies := defaultDependencies()
	dependencies.Passwordless = service
	webResponse := invokeHandler(t, NewHandlers(dependencies).OperationHandlers()["postAuthMagiclinkRedeem"], http.MethodPost, "/v1/auth/magic-link/redeem", `{"token":"synthetic-token","client":"web"}`, requestHeaders(testWebOrigin), false)
	if webResponse.Code != http.StatusOK || !strings.Contains(webResponse.Body.String(), `"returnPath":"/vaults"`) || strings.Contains(webResponse.Body.String(), session.RefreshToken) {
		t.Fatalf("web redemption response = %d %s", webResponse.Code, webResponse.Body.String())
	}
	cookies := webResponse.Header().Values("Set-Cookie")
	if len(cookies) != 4 {
		t.Fatalf("web redemption set %d cookies; want access, refresh, assertion, and return-path clear: %#v", len(cookies), cookies)
	}
	for _, name := range []string{passwordlessAccessCookie, passwordlessRefreshCookie, passwordlessAssertionCookie} {
		if !strings.Contains(strings.Join(cookies, "\n"), name+"=") || !strings.Contains(strings.Join(cookies, "\n"), "HttpOnly; Secure; SameSite=Lax") {
			t.Errorf("session cookie %q missing secure attributes: %#v", name, cookies)
		}
	}
	if !strings.HasSuffix(cookies[3], "Max-Age=0; Path=/; Secure; SameSite=Lax") || strings.Contains(cookies[3], "HttpOnly") {
		t.Errorf("return-path cookie should be cleared and script-readable: %q", cookies[3])
	}

	pwaResponse := invokeHandler(t, NewHandlers(dependencies).OperationHandlers()["postAuthMagiclinkRedeem"], http.MethodPost, "/v1/auth/magic-link/redeem", `{"token":"synthetic-token","client":"pwa"}`, requestHeaders(testWebOrigin), false)
	if pwaResponse.Code != http.StatusOK || !strings.Contains(pwaResponse.Body.String(), session.RefreshToken) || len(pwaResponse.Header().Values("Set-Cookie")) != 0 {
		t.Fatalf("PWA redemption response = %d headers=%v body=%s", pwaResponse.Code, pwaResponse.Header(), pwaResponse.Body.String())
	}
}

func TestMagicLinkRedemptionMapsDisabledExpiredAndMalformedRequests(t *testing.T) {
	handler := NewHandlers(defaultDependencies()).OperationHandlers()["postAuthMagiclinkRedeem"]
	malformed := invokeHandler(t, handler, http.MethodPost, "/v1/auth/magic-link/redeem", `{"token":"","client":"web"}`, requestHeaders(testWebOrigin), false)
	if malformed.Code != http.StatusBadRequest || !strings.Contains(malformed.Body.String(), "invalid_request") {
		t.Fatalf("malformed response = %d %s", malformed.Code, malformed.Body.String())
	}
	dependencies := defaultDependencies()
	dependencies.Passwordless = &fakePasswordlessService{}
	expired := invokeHandler(t, NewHandlers(dependencies).OperationHandlers()["postAuthMagiclinkRedeem"], http.MethodPost, "/v1/auth/magic-link/redeem", `{"token":"synthetic-token","client":"web"}`, requestHeaders(testWebOrigin), false)
	if expired.Code != http.StatusBadRequest || !strings.Contains(expired.Body.String(), "link_expired") {
		t.Fatalf("expired response = %d %s", expired.Code, expired.Body.String())
	}
	dependencies.Passwordless = nil
	disabled := invokeHandler(t, NewHandlers(dependencies).OperationHandlers()["postAuthMagiclinkRedeem"], http.MethodPost, "/v1/auth/magic-link/redeem", `{"token":"synthetic-token","client":"web"}`, requestHeaders(testWebOrigin), false)
	if disabled.Code != http.StatusBadRequest || !strings.Contains(disabled.Body.String(), "redemption_failed") {
		t.Fatalf("disabled response = %d %s", disabled.Code, disabled.Body.String())
	}
}

func TestPWAHandoffRequiresSameOriginAndReturnsPendingOrPublished(t *testing.T) {
	operations := NewHandlers(defaultDependencies()).OperationHandlers()
	handler := operations["postAuthPwaSession"]
	body := `{"handoffId":"abcdefghijklmnop","verifier":"abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK"}`
	forbidden := invokeHandler(t, handler, http.MethodPost, "/v1/auth/pwa/session", body, requestHeaders("https://attacker.example.test"), false)
	if forbidden.Code != http.StatusForbidden || forbidden.Body.Len() != 0 {
		t.Fatalf("foreign origin response = %d %q", forbidden.Code, forbidden.Body.String())
	}
	pending := invokeHandler(t, handler, http.MethodPost, "/v1/auth/pwa/session", body, requestHeaders(testWebOrigin), false)
	if pending.Code != http.StatusAccepted || pending.Body.String() != "{\"pending\":true}\n" {
		t.Fatalf("pending response = %d %q", pending.Code, pending.Body.String())
	}
	publishBody := `{"handoffId":"abcdefghijklmnop","refreshToken":"abcdefghijklmnop.` + strings.Repeat("r", 43) + `"}`
	published := invokeHandler(t, handler, http.MethodPost, "/v1/auth/pwa/session", publishBody, requestHeaders(testWebOrigin), false)
	if published.Code != http.StatusOK || published.Body.String() != "{\"published\":true}\n" {
		t.Fatalf("published response = %d %q", published.Code, published.Body.String())
	}
	invalid := invokeHandler(t, handler, http.MethodPost, "/v1/auth/pwa/session", `{"handoffId":"abcdefghijklmnop","refreshToken":"x","verifier":"abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK"}`, requestHeaders(testWebOrigin), false)
	if invalid.Code != http.StatusBadRequest || !strings.Contains(invalid.Body.String(), "invalid_request") {
		t.Fatalf("union-invalid response = %d %s", invalid.Code, invalid.Body.String())
	}
}

func TestRefreshSessionRequiresOriginAndProxyBackedSession(t *testing.T) {
	handler := NewHandlers(defaultDependencies()).OperationHandlers()["postAuthSessionRefresh"]
	badAuth := requestHeaders(testWebOrigin)
	badAuth.Set("Authorization", "Bearer synthetic-token")
	invalid := invokeHandler(t, handler, http.MethodPost, "/v1/auth/session/refresh", `{"client":"web"}`, badAuth, false)
	if invalid.Code != http.StatusBadRequest || !strings.Contains(invalid.Body.String(), "invalid_request") {
		t.Fatalf("authorization response = %d %s", invalid.Code, invalid.Body.String())
	}
	missingOrigin := invokeHandler(t, handler, http.MethodPost, "/v1/auth/session/refresh", `{"client":"web"}`, make(http.Header), false)
	if missingOrigin.Code != http.StatusForbidden {
		t.Fatalf("missing-origin response = %d", missingOrigin.Code)
	}
	verifier := &fakeSessionVerifier{}
	dependencies := defaultDependencies()
	dependencies.SessionVerifier = verifier
	cookies := requestHeaders(testWebOrigin)
	cookies.Set("Cookie", passwordlessAssertionCookie+"=synthetic-assertion")
	unauthorized := invokeHandler(t, NewHandlers(dependencies).OperationHandlers()["postAuthSessionRefresh"], http.MethodPost, "/v1/auth/session/refresh", `{"client":"web"}`, cookies, true)
	if unauthorized.Code != http.StatusUnauthorized || !strings.Contains(unauthorized.Body.String(), "session_expired") {
		t.Fatalf("expired response = %d %s", unauthorized.Code, unauthorized.Body.String())
	}
	setCookies := unauthorized.Header().Values("Set-Cookie")
	if len(setCookies) != 3 || !strings.Contains(strings.Join(setCookies, "\n"), "Max-Age=0") {
		t.Fatalf("expired session did not clear cookies: %#v", setCookies)
	}
	if verifier.minimum != identityapp.AssuranceActiveSession || !verifier.trusted {
		t.Fatalf("session verifier received minimum=%q trustedProxy=%v", verifier.minimum, verifier.trusted)
	}
}

func TestRefreshSessionRenewsPasswordlessAssertionOnly(t *testing.T) {
	principal := &identityapp.Principal{
		Issuer:           identityapp.PasswordlessIssuer,
		Subject:          "synthetic-subject",
		Email:            "person@example.test",
		EmailVerified:    true,
		Assurance:        identityapp.AssuranceActiveSession,
		SessionID:        "0123456789abcdef0123456789abcdef",
		SessionExpiresAt: testNow.Add(30 * 24 * time.Hour),
	}
	verifier := &fakeSessionVerifier{principal: principal}
	service := &fakePasswordlessService{signedAssertion: "renewed-assertion"}
	dependencies := defaultDependencies()
	dependencies.Passwordless = service
	dependencies.SessionVerifier = verifier
	headers := requestHeaders(testWebOrigin)
	headers.Set("Cookie", passwordlessAssertionCookie+"=old-assertion")
	response := invokeHandler(t, NewHandlers(dependencies).OperationHandlers()["postAuthSessionRefresh"], http.MethodPost, "/v1/auth/session/refresh", `{"client":"web"}`, headers, true)
	if response.Code != http.StatusOK || response.Body.String() != "{\"refreshed\":true}\n" {
		t.Fatalf("refresh response = %d %s", response.Code, response.Body.String())
	}
	cookies := response.Header().Values("Set-Cookie")
	if len(cookies) != 1 || !strings.HasPrefix(cookies[0], passwordlessAssertionCookie+"=renewed-assertion;") {
		t.Fatalf("refresh should renew only the assertion cookie: %#v", cookies)
	}
	if !strings.Contains(cookies[0], "Max-Age=604800") {
		t.Fatalf("assertion cookie Max-Age = %q, want the seven-day limit", cookies[0])
	}
	principal.Issuer = "e2e"
	response = invokeHandler(t, NewHandlers(dependencies).OperationHandlers()["postAuthSessionRefresh"], http.MethodPost, "/v1/auth/session/refresh", `{"client":"web"}`, headers, true)
	if response.Code != http.StatusOK || len(response.Header().Values("Set-Cookie")) != 0 {
		t.Fatalf("non-passwordless refresh should not set assertion: %d %#v", response.Code, response.Header().Values("Set-Cookie"))
	}
}

func TestRevokeSessionIsIdempotentAndClearsCredentialCookies(t *testing.T) {
	service := &fakePasswordlessService{revokeError: errors.New("synthetic database error")}
	dependencies := defaultDependencies()
	dependencies.Passwordless = service
	dependencies.NodeEnvironment = "development"
	dependencies.E2EBrowserTests = "1"
	handler := NewHandlers(dependencies).OperationHandlers()["postAuthSessionRevoke"]
	headers := requestHeaders(testWebOrigin)
	headers.Set("Cookie", passwordlessRefreshCookie+"=0123456789abcdef.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK")
	response := invokeHandler(t, handler, http.MethodPost, "/v1/auth/session/revoke", "", headers, true)
	if response.Code != http.StatusNoContent || response.Body.Len() != 0 {
		t.Fatalf("logout response = %d %q", response.Code, response.Body.String())
	}
	if len(service.revokeCalls) != 1 || service.revokeCalls[0] != "0123456789abcdef" {
		t.Fatalf("refresh-cookie logout did not revoke its session: %#v", service.revokeCalls)
	}
	cookies := response.Header().Values("Set-Cookie")
	if len(cookies) != 5 {
		t.Fatalf("logout wrote %d cookies; want E2E plus three session clears and repeated assertion clear: %#v", len(cookies), cookies)
	}
	if !strings.HasPrefix(cookies[0], e2eSessionCookie+"=") || !strings.Contains(strings.Join(cookies, "\n"), "Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax") {
		t.Fatalf("logout cookie clearing mismatch: %#v", cookies)
	}

	accessOnly := requestHeaders(testWebOrigin)
	accessOnly.Set("Cookie", passwordlessAccessCookie+"=0123456789abcdef."+strings.Repeat("a", 43))
	service.accessPrincipal = &identityapp.Principal{SessionID: "0123456789abcdef"}
	response = invokeHandler(t, handler, http.MethodPost, "/v1/auth/session/revoke", "", accessOnly, true)
	if response.Code != http.StatusNoContent || len(service.revokeCalls) != 2 || service.revokeCalls[1] != "0123456789abcdef" {
		t.Fatalf("access-cookie logout response=%d revocations=%#v", response.Code, service.revokeCalls)
	}
}

func TestRevokeSessionRejectsAuthorizationAndUntrustedCookieRequests(t *testing.T) {
	handler := NewHandlers(defaultDependencies()).OperationHandlers()["postAuthSessionRevoke"]
	authorized := requestHeaders(testWebOrigin)
	authorized.Set("Authorization", "Bearer synthetic")
	response := invokeHandler(t, handler, http.MethodPost, "/v1/auth/session/revoke", "", authorized, false)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "invalid_request") {
		t.Fatalf("authorization logout response = %d %s", response.Code, response.Body.String())
	}
	cookie := requestHeaders(testWebOrigin)
	cookie.Set("Cookie", passwordlessRefreshCookie+"=synthetic")
	response = invokeHandler(t, handler, http.MethodPost, "/v1/auth/session/revoke", "", cookie, false)
	if response.Code != http.StatusForbidden || response.Body.Len() != 0 {
		t.Fatalf("untrusted-cookie logout response = %d %q", response.Code, response.Body.String())
	}
	foreignOrigin := requestHeaders("https://attacker.example.test")
	response = invokeHandler(t, handler, http.MethodPost, "/v1/auth/session/revoke", "", foreignOrigin, false)
	if response.Code != http.StatusForbidden {
		t.Fatalf("foreign-origin logout response = %d", response.Code)
	}
}

func stringMapValue(fields []map[string]any, key string) string {
	if len(fields) == 0 {
		return ""
	}
	value, _ := fields[0][key].(string)
	return value
}
