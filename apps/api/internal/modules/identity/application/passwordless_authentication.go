package application

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const (
	PasswordlessIssuer                 = "rhasia:passwordless"
	PasswordlessAssertionIssuer        = "rhasia:passwordless-browser"
	PasswordlessAssertionAudience      = "rhasia:web"
	PasswordlessAssertionMaxAgeSeconds = 7 * 24 * 60 * 60
	PasswordlessAccessCookie           = "rhsia-passwordless-access"
	PasswordlessRefreshCookie          = "rhsia-passwordless-refresh"
	PasswordlessAssertionCookie        = "rhsia-passwordless-assertion"
	AuthReturnPathCookie               = "rhsia-auth-return-path"
)

var (
	passwordlessEmailPattern = regexp.MustCompile(`^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+\-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$`)
	passwordlessTokenPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43,128}$`)
	sessionIDPattern         = regexp.MustCompile(`^[A-Za-z0-9_-]{16,128}$`)
	sessionCredentialPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{16,128}\.[A-Za-z0-9_-]{43,128}$`)
)

type PasswordlessClient string

const (
	PasswordlessClientWeb PasswordlessClient = "web"
	PasswordlessClientPWA PasswordlessClient = "pwa"
)

type PasswordlessReturnPath string

const (
	PasswordlessReturnPathVaults           PasswordlessReturnPath = "/vaults"
	PasswordlessReturnPathInvitationRedeem PasswordlessReturnPath = "/vaults/invitations/redeem"
)

type MagicLinkChallenge struct {
	Email      string
	Client     PasswordlessClient
	ReturnPath PasswordlessReturnPath
	CreatedAt  time.Time
}

type PWAHandoffChallenge struct {
	IDDigest       []byte
	VerifierDigest []byte
	ExpiresAt      time.Time
}

type PasswordlessSession struct {
	SessionID        string
	AccessToken      string
	RefreshToken     string
	AccessExpiresAt  time.Time
	RefreshExpiresAt time.Time
	Principal        Principal
}

type PasswordlessAccount struct {
	ApplicationUserID string
	Issuer            string
	Subject           string
	Email             string
}

type PasswordlessAuthRepository interface {
	CreateChallenge(context.Context, []byte, MagicLinkChallenge, time.Time, *PWAHandoffChallenge) error
	ConsumeChallenge(context.Context, []byte, PasswordlessClient, time.Time) (*MagicLinkChallenge, error)
	FindOrCreateAccount(context.Context, string, time.Time, time.Time) (PasswordlessAccount, error)
	CreateSession(context.Context, PasswordlessAccount, time.Time) (PasswordlessSession, error)
	VerifyAccessToken(context.Context, []byte, time.Time) (*Principal, error)
	VerifyBrowserSession(context.Context, string, time.Time) (*Principal, error)
	RevokeSession(context.Context, string, time.Time, string) error
	PublishPWAHandoff(context.Context, []byte, string, []byte, time.Time) (bool, error)
	RedeemPWAHandoff(context.Context, []byte, []byte, time.Time) (*PasswordlessSession, PasswordlessReturnPath, error)
}

type MagicLinkEmailSender interface {
	SendMagicLink(context.Context, string, *url.URL) error
}

type PasswordlessConfiguration struct {
	AppOrigin              *url.URL
	MagicLinkSecret        []byte
	SessionSecret          []byte
	MagicLinkTTLSeconds    int
	AccessTokenTTLSeconds  int
	RefreshTokenTTLSeconds int
}

type PasswordlessChallengePersistenceError struct {
	cause error
}

func (err *PasswordlessChallengePersistenceError) Error() string {
	return "Magic-link challenge persistence failed."
}

func (err *PasswordlessChallengePersistenceError) Unwrap() error {
	return err.cause
}

type PasswordlessEmailDeliveryError struct {
	cause error
}

func (err *PasswordlessEmailDeliveryError) Error() string {
	return "Magic-link email delivery failed."
}

func (err *PasswordlessEmailDeliveryError) Unwrap() error {
	return err.cause
}

type PasswordlessAuthService struct {
	repository PasswordlessAuthRepository
	sender     MagicLinkEmailSender
	config     PasswordlessConfiguration
	now        func() time.Time
}

func NewPasswordlessAuthService(repository PasswordlessAuthRepository, sender MagicLinkEmailSender, configuration PasswordlessConfiguration, now func() time.Time) (*PasswordlessAuthService, error) {
	if repository == nil || sender == nil || configuration.AppOrigin == nil || len(configuration.MagicLinkSecret) < 32 || len(configuration.SessionSecret) < 32 || configuration.MagicLinkTTLSeconds < 1 || configuration.AccessTokenTTLSeconds < 1 || configuration.RefreshTokenTTLSeconds < 1 {
		return nil, errors.New("passwordless authentication is not configured")
	}
	if now == nil {
		now = time.Now
	}
	return &PasswordlessAuthService{repository: repository, sender: sender, config: configuration, now: now}, nil
}

func (service *PasswordlessAuthService) RequestLink(ctx context.Context, input struct {
	Email           string
	Client          PasswordlessClient
	ReturnPath      PasswordlessReturnPath
	TurnstileToken  string
	HandoffID       string
	HandoffVerifier string
}) error {
	email := strings.ToLower(strings.TrimSpace(input.Email))
	if len(email) == 0 || len(email) > 254 || !IsValidPasswordlessEmail(email) || !validPasswordlessClient(input.Client) || !validReturnPath(input.ReturnPath) {
		return errors.New("magic-link request is invalid")
	}
	if input.Client == PasswordlessClientPWA {
		if !safePWAHandoffID(input.HandoffID) || !safePWAHandoffVerifier(input.HandoffVerifier) {
			return errors.New("PWA authentication handoff is invalid")
		}
	} else if input.HandoffID != "" || input.HandoffVerifier != "" {
		return errors.New("PWA authentication handoff is invalid")
	}

	rawToken, err := randomBase64URLToken(32)
	if err != nil {
		return err
	}
	now := service.now()
	expiresAt := now.Add(time.Duration(service.config.MagicLinkTTLSeconds) * time.Second)
	var handoff *PWAHandoffChallenge
	if input.Client == PasswordlessClientPWA {
		handoff = &PWAHandoffChallenge{
			IDDigest:       service.digestMagicToken(input.HandoffID),
			VerifierDigest: service.digestMagicToken(input.HandoffVerifier),
			ExpiresAt:      expiresAt,
		}
	}
	challenge := MagicLinkChallenge{Email: email, Client: input.Client, ReturnPath: input.ReturnPath}
	if err := service.repository.CreateChallenge(ctx, service.digestMagicToken(rawToken), challenge, expiresAt, handoff); err != nil {
		return &PasswordlessChallengePersistenceError{cause: err}
	}
	actionURL, err := buildPasswordlessActionURL(service.config.AppOrigin, input.Client, rawToken, input.ReturnPath, input.HandoffID)
	if err != nil {
		return fmt.Errorf("build magic-link action URL: %w", err)
	}
	if err := service.sender.SendMagicLink(ctx, email, actionURL); err != nil {
		return &PasswordlessEmailDeliveryError{cause: err}
	}
	return nil
}

func (service *PasswordlessAuthService) Redeem(ctx context.Context, token string, client PasswordlessClient) (*PasswordlessSession, PasswordlessReturnPath, error) {
	if !passwordlessTokenPattern.MatchString(token) || !validPasswordlessClient(client) {
		return nil, "", nil
	}
	now := service.now()
	challenge, err := service.repository.ConsumeChallenge(ctx, service.digestMagicToken(token), client, now)
	if err != nil || challenge == nil {
		return nil, "", err
	}
	account, err := service.repository.FindOrCreateAccount(ctx, challenge.Email, challenge.CreatedAt, now)
	if err != nil {
		return nil, "", err
	}
	session, err := service.repository.CreateSession(ctx, account, now)
	if err != nil {
		return nil, "", err
	}
	return &session, challenge.ReturnPath, nil
}

func (service *PasswordlessAuthService) VerifyAccessToken(ctx context.Context, token string) (*Principal, error) {
	if !sessionCredentialPattern.MatchString(token) {
		return nil, nil
	}
	return service.repository.VerifyAccessToken(ctx, service.digestSessionToken(token), service.now())
}

func (service *PasswordlessAuthService) VerifyBrowserSession(ctx context.Context, sessionID string) (*Principal, error) {
	if !sessionIDPattern.MatchString(sessionID) {
		return nil, nil
	}
	return service.repository.VerifyBrowserSession(ctx, sessionID, service.now())
}

func (service *PasswordlessAuthService) Revoke(ctx context.Context, sessionID string, reason string) error {
	if !sessionIDPattern.MatchString(sessionID) {
		return nil
	}
	if reason == "" {
		reason = "logout"
	}
	return service.repository.RevokeSession(ctx, sessionID, service.now(), reason)
}

func (service *PasswordlessAuthService) PublishPWAHandoff(ctx context.Context, refreshToken string, handoffID string) error {
	if !sessionCredentialPattern.MatchString(refreshToken) || !safePWAHandoffID(handoffID) {
		return errors.New("PWA authentication handoff is invalid")
	}
	sessionID, _, _ := strings.Cut(refreshToken, ".")
	published, err := service.repository.PublishPWAHandoff(ctx, service.digestSessionToken(refreshToken), sessionID, service.digestMagicToken(handoffID), service.now())
	if err != nil || !published {
		return errors.New("PWA authentication handoff is invalid")
	}
	return nil
}

func (service *PasswordlessAuthService) RedeemPWAHandoff(ctx context.Context, handoffID string, verifier string) (*PasswordlessSession, PasswordlessReturnPath, error) {
	if !safePWAHandoffID(handoffID) || !safePWAHandoffVerifier(verifier) {
		return nil, "", nil
	}
	return service.repository.RedeemPWAHandoff(ctx, service.digestMagicToken(handoffID), service.digestMagicToken(verifier), service.now())
}

func (service *PasswordlessAuthService) SignBrowserAssertion(sessionID string, expiresAt time.Time) (string, error) {
	if !sessionIDPattern.MatchString(sessionID) {
		return "", errors.New("browser session identifier is invalid")
	}
	now := service.now()
	maximumExpiry := now.Add(PasswordlessAssertionMaxAgeSeconds * time.Second)
	if expiresAt.After(maximumExpiry) {
		expiresAt = maximumExpiry
	}
	return SignBrowserAssertion(service.config.SessionSecret, sessionID, now, expiresAt)
}

func (service *PasswordlessAuthService) digestMagicToken(token string) []byte {
	return hmacSHA256(service.config.MagicLinkSecret, token)
}

func (service *PasswordlessAuthService) digestSessionToken(token string) []byte {
	return hmacSHA256(service.config.SessionSecret, token)
}

func hmacSHA256(secret []byte, value string) []byte {
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(value))
	return mac.Sum(nil)
}

func randomBase64URLToken(size int) (string, error) {
	if size < 1 || size > 1024 {
		return "", errors.New("token size is invalid")
	}
	bytes := make([]byte, size)
	if _, err := rand.Read(bytes); err != nil {
		clear(bytes)
		return "", fmt.Errorf("generate authentication token: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(bytes)
	clear(bytes)
	return token, nil
}

func IsValidPasswordlessEmail(email string) bool {
	return passwordlessEmailPattern.MatchString(email)
}

func validPasswordlessClient(client PasswordlessClient) bool {
	return client == PasswordlessClientWeb || client == PasswordlessClientPWA
}

func validReturnPath(path PasswordlessReturnPath) bool {
	return path == PasswordlessReturnPathVaults || path == PasswordlessReturnPathInvitationRedeem
}

func safePWAHandoffID(value string) bool {
	return len(value) >= 16 && len(value) <= 128 && safeURLToken(value)
}

func safePWAHandoffVerifier(value string) bool {
	return len(value) >= 43 && len(value) <= 128 && safeURLToken(value)
}

func safeURLToken(value string) bool {
	for _, character := range value {
		if !(character >= 'A' && character <= 'Z') && !(character >= 'a' && character <= 'z') && !(character >= '0' && character <= '9') && character != '_' && character != '-' {
			return false
		}
	}
	return true
}

func buildPasswordlessActionURL(origin *url.URL, client PasswordlessClient, token string, returnPath PasswordlessReturnPath, handoffID string) (*url.URL, error) {
	if origin == nil || !validPasswordlessClient(client) || !validReturnPath(returnPath) {
		return nil, errors.New("passwordless action URL configuration is invalid")
	}
	result := *origin
	result.Path = "/auth/confirm"
	if client == PasswordlessClientPWA {
		result.Path = "/auth/pwa-confirm"
		if !safePWAHandoffID(handoffID) {
			return nil, errors.New("PWA authentication handoff is invalid")
		}
	} else if handoffID != "" {
		return nil, errors.New("PWA authentication handoff is invalid")
	}
	result.RawQuery = ""
	fragment := "token=" + url.QueryEscape(token) + "&next=" + url.QueryEscape(string(returnPath))
	if client == PasswordlessClientPWA {
		fragment += "&handoff=" + url.QueryEscape(handoffID)
	}
	decodedFragment, err := url.QueryUnescape(fragment)
	if err != nil {
		return nil, err
	}
	result.Fragment = decodedFragment
	result.RawFragment = fragment
	return &result, nil
}
