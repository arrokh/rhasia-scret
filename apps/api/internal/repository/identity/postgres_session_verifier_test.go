package infrastructure

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"

	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/identity"
)

func TestPostgresSessionVerifierValidatesBrowserAssertions(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC)
	secret := []byte("synthetic-session-secret-with-at-least-32-bytes")
	verifier := &PostgresSessionVerifier{sessionSecret: secret}
	valid := signedAssertion(t, secret, map[string]any{
		"session_id": "0123456789abcdef0123456789abcdef",
		"iss":        assertionIssuer,
		"aud":        assertionAudience,
		"iat":        now.Add(-time.Minute).Unix(),
		"exp":        now.Add(time.Minute).Unix(),
	})
	sessionID, err := verifier.verifyAssertion(valid, now)
	if err != nil || sessionID != "0123456789abcdef0123456789abcdef" {
		t.Fatalf("verifyAssertion() = %q, %v; want the signed session identifier", sessionID, err)
	}

	cases := []struct {
		name    string
		claims  map[string]any
		altered string
	}{
		{name: "expired", claims: map[string]any{"session_id": "0123456789abcdef0123456789abcdef", "iss": assertionIssuer, "aud": assertionAudience, "exp": now.Unix()}},
		{name: "wrong issuer", claims: map[string]any{"session_id": "0123456789abcdef0123456789abcdef", "iss": "unexpected", "aud": assertionAudience, "exp": now.Add(time.Minute).Unix()}},
		{name: "wrong audience", claims: map[string]any{"session_id": "0123456789abcdef0123456789abcdef", "iss": assertionIssuer, "aud": "unexpected", "exp": now.Add(time.Minute).Unix()}},
		{name: "unsafe session id", claims: map[string]any{"session_id": "not/a/session", "iss": assertionIssuer, "aud": assertionAudience, "exp": now.Add(time.Minute).Unix()}},
		{name: "tampered signature", altered: tamperAssertionSignature(valid)},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			token := testCase.altered
			if token == "" {
				token = signedAssertion(t, secret, testCase.claims)
			}
			if _, err := verifier.verifyAssertion(token, now); err == nil {
				t.Fatal("verifyAssertion() error = nil; want rejection")
			}
		})
	}
}

func TestPostgresSessionVerifierRejectsUntrustedRequestBeforeDatabaseAccess(t *testing.T) {
	t.Parallel()

	verifier := &PostgresSessionVerifier{sessionSecret: []byte("synthetic-session-secret-with-at-least-32-bytes")}
	cases := []struct {
		name        string
		credentials identityapp.SessionCredentials
	}{
		{name: "authorization header", credentials: identityapp.SessionCredentials{AuthorizationPresent: true, TrustedProxy: true}},
		{name: "untrusted proxy", credentials: identityapp.SessionCredentials{CookieHeader: passwordlessAssertion + "=opaque", TrustedProxy: false}},
		{name: "missing credential", credentials: identityapp.SessionCredentials{TrustedProxy: true}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			principal, err := verifier.Verify(context.Background(), testCase.credentials, identityapp.AssuranceFreshProvider)
			if err != nil || principal != nil {
				t.Fatalf("Verify() = %#v, %v; want no principal without database access", principal, err)
			}
		})
	}
}

func TestPasswordlessSessionCredentialAndCookiesAreBounded(t *testing.T) {
	t.Parallel()

	if !isSessionCredential("0123456789abcdef0123456789abcdef." + repeatToken('A', 43)) {
		t.Fatal("isSessionCredential() rejected a valid synthetic credential")
	}
	invalid := []string{
		"short." + repeatToken('A', 43),
		"0123456789abcdef0123456789abcdef." + repeatToken('!', 43),
		"0123456789abcdef0123456789abcdef." + repeatToken('A', 129),
	}
	for _, value := range invalid {
		if isSessionCredential(value) {
			t.Errorf("isSessionCredential(%q) = true; want false", value)
		}
	}

	cookies := parseCookieHeader(" first = one ; rhsia-passwordless-assertion=old; rhsia-passwordless-assertion = current ")
	if cookies[passwordlessAssertion] != "current" {
		t.Fatalf("duplicate assertion cookie = %q; want last value", cookies[passwordlessAssertion])
	}
}

func signedAssertion(t *testing.T, secret []byte, claims map[string]any) string {
	t.Helper()
	header, err := json.Marshal(map[string]string{"alg": "HS256", "typ": "JWT"})
	if err != nil {
		t.Fatal(err)
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		t.Fatal(err)
	}
	encodedHeader := base64.RawURLEncoding.EncodeToString(header)
	encodedPayload := base64.RawURLEncoding.EncodeToString(payload)
	unsigned := encodedHeader + "." + encodedPayload
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(unsigned))
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func tamperAssertionSignature(token string) string {
	parts := strings.Split(token, ".")
	if len(parts) != 3 || len(parts[2]) == 0 {
		return token + "x"
	}
	replacement := byte('A')
	if parts[2][0] == replacement {
		replacement = 'B'
	}
	return parts[0] + "." + parts[1] + "." + string(replacement) + parts[2][1:]
}

func repeatToken(character byte, count int) string {
	value := make([]byte, count)
	for index := range value {
		value[index] = character
	}
	return string(value)
}
