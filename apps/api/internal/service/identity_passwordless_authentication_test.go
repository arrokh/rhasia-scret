package service

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/localization"
)

type passwordlessRepositoryStub struct {
	challenge                 *MagicLinkChallenge
	tokenDigest               []byte
	expiresAt                 time.Time
	handoff                   *PWAHandoffChallenge
	createErr                 error
	consume                   *MagicLinkChallenge
	consumeErr                error
	account                   PasswordlessAccount
	accountChallengeCreatedAt time.Time
	accountErr                error
	session                   PasswordlessSession
	sessionErr                error
	verifyAccess              *Principal
	verifyBrowser             *Principal
	revokeErr                 error
	published                 bool
	publishErr                error
	redeemSession             *PasswordlessSession
	redeemReturnPath          PasswordlessReturnPath
	redeemErr                 error
	calls                     []string
}

func (repository *passwordlessRepositoryStub) CreateChallenge(_ context.Context, digest []byte, challenge MagicLinkChallenge, expiresAt time.Time, handoff *PWAHandoffChallenge) error {
	repository.calls = append(repository.calls, "create-challenge")
	repository.tokenDigest = append([]byte(nil), digest...)
	repository.challenge = &challenge
	repository.expiresAt = expiresAt
	if handoff != nil {
		copyOfHandoff := *handoff
		copyOfHandoff.IDDigest = append([]byte(nil), handoff.IDDigest...)
		copyOfHandoff.VerifierDigest = append([]byte(nil), handoff.VerifierDigest...)
		repository.handoff = &copyOfHandoff
	}
	return repository.createErr
}

func (repository *passwordlessRepositoryStub) ConsumeChallenge(context.Context, []byte, PasswordlessClient, time.Time) (*MagicLinkChallenge, error) {
	repository.calls = append(repository.calls, "consume-challenge")
	return repository.consume, repository.consumeErr
}

func (repository *passwordlessRepositoryStub) FindOrCreateAccount(_ context.Context, _ string, challengeCreatedAt time.Time, _ time.Time) (PasswordlessAccount, error) {
	repository.calls = append(repository.calls, "find-or-create-account")
	repository.accountChallengeCreatedAt = challengeCreatedAt
	return repository.account, repository.accountErr
}

func (repository *passwordlessRepositoryStub) CreateSession(context.Context, PasswordlessAccount, time.Time) (PasswordlessSession, error) {
	repository.calls = append(repository.calls, "create-session")
	return repository.session, repository.sessionErr
}

func (repository *passwordlessRepositoryStub) VerifyAccessToken(context.Context, []byte, time.Time) (*Principal, error) {
	repository.calls = append(repository.calls, "verify-access")
	return repository.verifyAccess, nil
}

func (repository *passwordlessRepositoryStub) VerifyBrowserSession(context.Context, string, time.Time) (*Principal, error) {
	repository.calls = append(repository.calls, "verify-browser")
	return repository.verifyBrowser, nil
}

func (repository *passwordlessRepositoryStub) RevokeSession(context.Context, string, time.Time, string) error {
	repository.calls = append(repository.calls, "revoke")
	return repository.revokeErr
}

func (repository *passwordlessRepositoryStub) PublishPWAHandoff(context.Context, []byte, string, []byte, time.Time) (bool, error) {
	repository.calls = append(repository.calls, "publish-pwa")
	return repository.published, repository.publishErr
}

func (repository *passwordlessRepositoryStub) RedeemPWAHandoff(context.Context, []byte, []byte, time.Time) (*PasswordlessSession, PasswordlessReturnPath, error) {
	repository.calls = append(repository.calls, "redeem-pwa")
	return repository.redeemSession, repository.redeemReturnPath, repository.redeemErr
}

type magicLinkSenderStub struct {
	email  string
	url    *url.URL
	locale localization.Locale
	err    error
	calls  int
}

func (sender *magicLinkSenderStub) SendMagicLink(_ context.Context, email string, link *url.URL, locale localization.Locale) error {
	sender.calls++
	sender.email = email
	sender.locale = locale
	copyOfURL := *link
	sender.url = &copyOfURL
	return sender.err
}

func newPasswordlessServiceForTest(t *testing.T, repository PasswordlessAuthRepository, sender MagicLinkEmailSender, now time.Time) *PasswordlessAuthService {
	t.Helper()
	origin, err := url.Parse("https://auth.example.test")
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewPasswordlessAuthService(repository, sender, PasswordlessConfiguration{
		AppOrigin:              origin,
		MagicLinkSecret:        []byte(strings.Repeat("m", 32)),
		SessionSecret:          []byte(strings.Repeat("s", 32)),
		MagicLinkTTLSeconds:    600,
		AccessTokenTTLSeconds:  900,
		RefreshTokenTTLSeconds: 3600,
	}, func() time.Time { return now })
	if err != nil {
		t.Fatalf("create passwordless service: %v", err)
	}
	return service
}

func TestPasswordlessRequestPersistsOnlyDigestsAndBuildsFragmentURL(t *testing.T) {
	now := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	repository := &passwordlessRepositoryStub{}
	sender := &magicLinkSenderStub{}
	service := newPasswordlessServiceForTest(t, repository, sender, now)

	err := service.RequestLink(context.Background(), struct {
		Email           string
		Client          PasswordlessClient
		ReturnPath      PasswordlessReturnPath
		Locale          localization.Locale
		TurnstileToken  string
		HandoffID       string
		HandoffVerifier string
	}{Email: " Person@Example.test ", Client: PasswordlessClientWeb, ReturnPath: PasswordlessReturnPathVaults})
	if err != nil {
		t.Fatalf("request magic link: %v", err)
	}
	if repository.challenge == nil || repository.challenge.Email != "person@example.test" || repository.challenge.Client != PasswordlessClientWeb || repository.challenge.ReturnPath != PasswordlessReturnPathVaults {
		t.Fatalf("unexpected persisted challenge: %#v", repository.challenge)
	}
	if !repository.expiresAt.Equal(now.Add(600 * time.Second)) {
		t.Fatalf("challenge expiry mismatch: expires=%v", repository.expiresAt)
	}
	if sender.calls != 1 || sender.email != "person@example.test" || sender.url == nil || sender.locale != localization.Indonesian {
		t.Fatalf("unexpected email send: %#v", sender)
	}
	if sender.url.Scheme != "https" || sender.url.Host != "auth.example.test" || sender.url.Path != "/auth/confirm" || sender.url.RawQuery != "" {
		t.Fatalf("unexpected action URL: %s", sender.url)
	}
	fragment, err := url.ParseQuery(sender.url.Fragment)
	if err != nil || fragment.Get("token") == "" || fragment.Get("next") != "/vaults" {
		t.Fatalf("unexpected action fragment: %#v err=%v", fragment, err)
	}
	if !passwordlessTokenPattern.MatchString(fragment.Get("token")) || string(repository.tokenDigest) != string(service.digestMagicToken(fragment.Get("token"))) || sender.url.RawQuery != "" {
		t.Fatal("raw token was not confined to the transient action URL fragment or stored digest mismatched")
	}
}

func TestPasswordlessPWARequestPersistsSeparateHandoffDigests(t *testing.T) {
	now := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	repository := &passwordlessRepositoryStub{}
	sender := &magicLinkSenderStub{}
	service := newPasswordlessServiceForTest(t, repository, sender, now)
	handoffID := strings.Repeat("h", 16)
	verifier := strings.Repeat("v", 43)
	input := struct {
		Email           string
		Client          PasswordlessClient
		ReturnPath      PasswordlessReturnPath
		Locale          localization.Locale
		TurnstileToken  string
		HandoffID       string
		HandoffVerifier string
	}{Email: "person@example.test", Client: PasswordlessClientPWA, ReturnPath: PasswordlessReturnPathInvitationRedeem, Locale: localization.English, HandoffID: handoffID, HandoffVerifier: verifier}
	if err := service.RequestLink(context.Background(), input); err != nil {
		t.Fatalf("request PWA magic link: %v", err)
	}
	if repository.handoff == nil || string(repository.handoff.IDDigest) != string(service.digestMagicToken(handoffID)) || string(repository.handoff.VerifierDigest) != string(service.digestMagicToken(verifier)) || !repository.handoff.ExpiresAt.Equal(now.Add(600*time.Second)) {
		t.Fatalf("unexpected persisted handoff: %#v", repository.handoff)
	}
	if sender.url == nil || sender.url.Path != "/auth/pwa-confirm" || sender.locale != localization.English {
		t.Fatalf("unexpected PWA action URL: %#v", sender.url)
	}
	fragment, err := url.ParseQuery(sender.url.Fragment)
	if err != nil || fragment.Get("handoff") != handoffID || fragment.Get("token") == "" || sender.url.RawQuery != "" {
		t.Fatalf("unexpected PWA URL fragment %#v err=%v", fragment, err)
	}
}

func TestPasswordlessRequestRejectsMalformedEmailBeforePersistence(t *testing.T) {
	repository := &passwordlessRepositoryStub{}
	sender := &magicLinkSenderStub{}
	service := newPasswordlessServiceForTest(t, repository, sender, time.Now())
	err := service.RequestLink(context.Background(), struct {
		Email           string
		Client          PasswordlessClient
		ReturnPath      PasswordlessReturnPath
		Locale          localization.Locale
		TurnstileToken  string
		HandoffID       string
		HandoffVerifier string
	}{Email: "dummy@example..test", Client: PasswordlessClientWeb, ReturnPath: PasswordlessReturnPathVaults})
	if err == nil || len(repository.calls) != 0 || sender.calls != 0 {
		t.Fatalf("malformed email request err=%v persistence=%#v sends=%d", err, repository.calls, sender.calls)
	}
}

func TestPasswordlessRequestMapsPersistenceAndDeliveryFailures(t *testing.T) {
	input := struct {
		Email           string
		Client          PasswordlessClient
		ReturnPath      PasswordlessReturnPath
		Locale          localization.Locale
		TurnstileToken  string
		HandoffID       string
		HandoffVerifier string
	}{Email: "person@example.test", Client: PasswordlessClientWeb, ReturnPath: PasswordlessReturnPathVaults}
	cause := errors.New("synthetic dependency detail")

	t.Run("challenge persistence", func(t *testing.T) {
		repository := &passwordlessRepositoryStub{createErr: cause}
		service := newPasswordlessServiceForTest(t, repository, &magicLinkSenderStub{}, time.Now())
		err := service.RequestLink(context.Background(), input)
		var persistenceError *PasswordlessChallengePersistenceError
		if !errors.As(err, &persistenceError) {
			t.Fatalf("request error = %v; want typed persistence failure", err)
		}
	})

	t.Run("email delivery", func(t *testing.T) {
		repository := &passwordlessRepositoryStub{}
		sender := &magicLinkSenderStub{err: cause}
		service := newPasswordlessServiceForTest(t, repository, sender, time.Now())
		err := service.RequestLink(context.Background(), input)
		var deliveryError *PasswordlessEmailDeliveryError
		if !errors.As(err, &deliveryError) {
			t.Fatalf("request error = %v; want typed email delivery failure", err)
		}
		if len(repository.calls) != 1 || sender.calls != 1 {
			t.Fatalf("unexpected persistence/delivery calls: %#v %d", repository.calls, sender.calls)
		}
	})
}

func TestPasswordlessRedeemValidatesBeforeConsumingAndCreatesSession(t *testing.T) {
	now := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	session := PasswordlessSession{SessionID: strings.Repeat("s", 32), RefreshToken: strings.Repeat("r", 50)}
	repository := &passwordlessRepositoryStub{
		consume: &MagicLinkChallenge{Email: "person@example.test", Client: PasswordlessClientWeb, ReturnPath: PasswordlessReturnPathVaults, CreatedAt: now.Add(-time.Minute)},
		account: PasswordlessAccount{ApplicationUserID: "synthetic-user", Issuer: PasswordlessIssuer, Subject: "synthetic-subject", Email: "person@example.test"},
		session: session,
	}
	service := newPasswordlessServiceForTest(t, repository, &magicLinkSenderStub{}, now)
	result, path, err := service.Redeem(context.Background(), "invalid", PasswordlessClientWeb)
	if err != nil || result != nil || len(repository.calls) != 0 {
		t.Fatalf("invalid redemption = %#v %q %v calls=%#v", result, path, err, repository.calls)
	}
	result, path, err = service.Redeem(context.Background(), strings.Repeat("t", 43), PasswordlessClientWeb)
	if err != nil || result == nil || result.SessionID != session.SessionID || path != PasswordlessReturnPathVaults {
		t.Fatalf("redemption = %#v %q %v", result, path, err)
	}
	wantCalls := []string{"consume-challenge", "find-or-create-account", "create-session"}
	if strings.Join(repository.calls, ",") != strings.Join(wantCalls, ",") {
		t.Fatalf("redemption call order = %#v; want %#v", repository.calls, wantCalls)
	}
	if !repository.accountChallengeCreatedAt.Equal(now.Add(-time.Minute)) {
		t.Fatalf("account admission challenge time=%s; want challenge creation time %s", repository.accountChallengeCreatedAt, now.Add(-time.Minute))
	}
}

func TestPasswordlessPWAHandoffRequiresSafeCredentials(t *testing.T) {
	repository := &passwordlessRepositoryStub{published: true}
	service := newPasswordlessServiceForTest(t, repository, &magicLinkSenderStub{}, time.Now())
	if err := service.PublishPWAHandoff(context.Background(), "bad", strings.Repeat("h", 16)); err == nil {
		t.Fatal("accepted malformed refresh token")
	}
	if len(repository.calls) != 0 {
		t.Fatalf("malformed token reached repository: %#v", repository.calls)
	}
	refreshToken := strings.Repeat("s", 16) + "." + strings.Repeat("r", 43)
	if err := service.PublishPWAHandoff(context.Background(), refreshToken, strings.Repeat("h", 16)); err != nil {
		t.Fatalf("publish PWA handoff: %v", err)
	}
	if err := service.PublishPWAHandoff(context.Background(), refreshToken, strings.Repeat("h", 16)+"!"); err == nil {
		t.Fatal("accepted unsafe handoff identifier")
	}
	if len(repository.calls) != 1 {
		t.Fatalf("unexpected publish calls: %#v", repository.calls)
	}
}

func TestPasswordlessBrowserAssertionBoundaries(t *testing.T) {
	now := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	service := newPasswordlessServiceForTest(t, &passwordlessRepositoryStub{}, &magicLinkSenderStub{}, now)
	sessionID := strings.Repeat("s", 32)
	assertion, err := service.SignBrowserAssertion(sessionID, now.Add(24*time.Hour))
	if err != nil {
		t.Fatalf("sign browser assertion: %v", err)
	}
	verifiedSession, err := VerifyBrowserAssertion(service.config.SessionSecret, assertion, now)
	if err != nil || verifiedSession != sessionID {
		t.Fatalf("verified session = %q, %v", verifiedSession, err)
	}
	if _, err := VerifyBrowserAssertion(service.config.SessionSecret, assertion, now.Add(24*time.Hour)); err == nil {
		t.Fatal("accepted assertion at expiry")
	}
	if _, err := service.SignBrowserAssertion("unsafe", now.Add(time.Hour)); err == nil {
		t.Fatal("signed unsafe session identifier")
	}
}
