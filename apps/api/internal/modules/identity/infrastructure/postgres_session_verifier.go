package infrastructure

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity/application"
)

const (
	passwordlessIssuer       = "rhasia:passwordless"
	passwordlessAccessCookie = "rhsia-passwordless-access"
	passwordlessAssertion    = "rhsia-passwordless-assertion"
	assertionIssuer          = "rhasia:passwordless-browser"
	assertionAudience        = "rhasia:web"
)

var errInvalidAssertion = errors.New("invalid passwordless assertion")

type PostgresSessionVerifier struct {
	pool          *pgxpool.Pool
	sessionSecret []byte
	now           func() time.Time
}

func NewPostgresSessionVerifier(pool *pgxpool.Pool, sessionSecret []byte, now func() time.Time) (*PostgresSessionVerifier, error) {
	if pool == nil || len(sessionSecret) < 32 {
		return nil, errors.New("passwordless session verifier is not configured")
	}
	if now == nil {
		now = time.Now
	}
	return &PostgresSessionVerifier{pool: pool, sessionSecret: append([]byte(nil), sessionSecret...), now: now}, nil
}

func (verifier *PostgresSessionVerifier) Verify(ctx context.Context, credentials identityapp.SessionCredentials, minimum identityapp.SessionAssurance) (*identityapp.Principal, error) {
	if credentials.AuthorizationPresent || !credentials.TrustedProxy {
		return nil, nil
	}
	cookies := parseCookieHeader(credentials.CookieHeader)
	if assertion := cookies[passwordlessAssertion]; assertion != "" {
		sessionID, err := verifier.verifyAssertion(assertion, verifier.now())
		if err != nil {
			return nil, nil
		}
		return verifier.verifyBrowserSession(ctx, sessionID, minimum)
	}
	accessToken := cookies[passwordlessAccessCookie]
	if accessToken == "" {
		return nil, nil
	}
	return verifier.verifyAccessToken(ctx, accessToken, minimum)
}

func (verifier *PostgresSessionVerifier) verifyBrowserSession(ctx context.Context, sessionID string, minimum identityapp.SessionAssurance) (*identityapp.Principal, error) {
	if !isSafeSessionID(sessionID) {
		return nil, nil
	}
	principal, err := verifier.loadPrincipal(ctx, `
		WHERE s.id = $1
		  AND s.revoked_at IS NULL
		  AND s.refresh_expires_at > $2
		  AND u.status = 'ACTIVE'
		  AND e.email IS NOT NULL
		  AND e.email_verified_at IS NOT NULL`, sessionID, verifier.now())
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("verify passwordless browser session: %w", err)
	}
	if !identityapp.AssuranceSatisfies(principal.Assurance, minimum) {
		return nil, nil
	}
	return &principal, nil
}

func (verifier *PostgresSessionVerifier) verifyAccessToken(ctx context.Context, accessToken string, minimum identityapp.SessionAssurance) (*identityapp.Principal, error) {
	if !isSessionCredential(accessToken) {
		return nil, nil
	}
	digest := verifier.digest(accessToken)
	principal, err := verifier.loadPrincipal(ctx, `
		WHERE s.access_token_digest = $1
		  AND s.revoked_at IS NULL
		  AND s.access_expires_at > $2
		  AND u.status = 'ACTIVE'
		  AND e.email IS NOT NULL
		  AND e.email_verified_at IS NOT NULL`, digest, verifier.now())
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("verify passwordless access token: %w", err)
	}
	if !identityapp.AssuranceSatisfies(principal.Assurance, minimum) {
		return nil, nil
	}
	if _, err := verifier.pool.Exec(ctx, `UPDATE auth_sessions SET last_used_at = $2, updated_at = $2 WHERE id = $1`, principal.SessionID, verifier.now()); err != nil {
		return nil, fmt.Errorf("update passwordless session activity: %w", err)
	}
	return &principal, nil
}

func (verifier *PostgresSessionVerifier) loadPrincipal(ctx context.Context, condition string, firstArgument any, now time.Time) (identityapp.Principal, error) {
	query := `
		SELECT s.id, s.refresh_expires_at, s.created_at,
		       e.issuer, e.subject, e.email, e.email_verified_at
		FROM auth_sessions AS s
		JOIN application_users AS u ON u.id = s.application_user_id
		JOIN external_identities AS e ON e.application_user_id = u.id AND e.issuer = $3
		` + condition
	var row identityapp.Principal
	var emailVerifiedAt time.Time
	err := verifier.pool.QueryRow(ctx, query, firstArgument, now, passwordlessIssuer).Scan(
		&row.SessionID,
		&row.SessionExpiresAt,
		&row.IssuedAt,
		&row.Issuer,
		&row.Subject,
		&row.Email,
		&emailVerifiedAt,
	)
	if err != nil {
		return identityapp.Principal{}, err
	}
	row.EmailVerified = true
	row.Assurance = identityapp.AssuranceActiveSession
	return row, nil
}

func (verifier *PostgresSessionVerifier) digest(token string) []byte {
	mac := hmac.New(sha256.New, verifier.sessionSecret)
	_, _ = mac.Write([]byte(token))
	return mac.Sum(nil)
}

func (verifier *PostgresSessionVerifier) verifyAssertion(token string, now time.Time) (string, error) {
	if len(token) == 0 || len(token) > 8192 {
		return "", errInvalidAssertion
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", errInvalidAssertion
	}
	decode := base64.RawURLEncoding.Strict()
	headerBytes, err := decode.DecodeString(parts[0])
	if err != nil {
		return "", errInvalidAssertion
	}
	payloadBytes, err := decode.DecodeString(parts[1])
	if err != nil {
		return "", errInvalidAssertion
	}
	signature, err := decode.DecodeString(parts[2])
	if err != nil {
		return "", errInvalidAssertion
	}
	var header struct {
		Algorithm string `json:"alg"`
	}
	if json.Unmarshal(headerBytes, &header) != nil || header.Algorithm != "HS256" {
		return "", errInvalidAssertion
	}
	mac := hmac.New(sha256.New, verifier.sessionSecret)
	_, _ = mac.Write([]byte(parts[0] + "." + parts[1]))
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return "", errInvalidAssertion
	}
	var payload struct {
		SessionID string          `json:"session_id"`
		Issuer    string          `json:"iss"`
		Audience  json.RawMessage `json:"aud"`
		ExpiresAt int64           `json:"exp"`
	}
	if json.Unmarshal(payloadBytes, &payload) != nil ||
		!isSafeSessionID(payload.SessionID) ||
		payload.Issuer != assertionIssuer ||
		!assertionHasAudience(payload.Audience, assertionAudience) ||
		payload.ExpiresAt <= now.Unix() {
		return "", errInvalidAssertion
	}
	return payload.SessionID, nil
}

func assertionHasAudience(raw json.RawMessage, expected string) bool {
	var single string
	if json.Unmarshal(raw, &single) == nil {
		return single == expected
	}
	var multiple []string
	if json.Unmarshal(raw, &multiple) != nil {
		return false
	}
	for _, audience := range multiple {
		if audience == expected {
			return true
		}
	}
	return false
}

func parseCookieHeader(header string) map[string]string {
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

func isSafeSessionID(value string) bool {
	if len(value) < 16 || len(value) > 128 {
		return false
	}
	for _, character := range value {
		if !(character >= 'A' && character <= 'Z') && !(character >= 'a' && character <= 'z') && !(character >= '0' && character <= '9') && character != '_' && character != '-' {
			return false
		}
	}
	return true
}

func isSessionCredential(value string) bool {
	sessionID, secret, found := strings.Cut(value, ".")
	return found && isSafeSessionID(sessionID) && isSafeToken(secret, 43, 128)
}

func isSafeToken(value string, minimum int, maximum int) bool {
	if len(value) < minimum || len(value) > maximum {
		return false
	}
	for _, character := range value {
		if !(character >= 'A' && character <= 'Z') && !(character >= 'a' && character <= 'z') && !(character >= '0' && character <= '9') && character != '_' && character != '-' {
			return false
		}
	}
	return true
}

var _ identityapp.SessionVerifier = (*PostgresSessionVerifier)(nil)
