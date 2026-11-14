package infrastructure

import (
	"context"
	"strings"
	"testing"

	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/identity"
)

func TestE2ESessionVerifierIsDevelopmentOnly(t *testing.T) {
	if verifier := NewE2ESessionVerifier("production", "1", `{"hosted":{"subject":"synthetic-user","email":"person@example.test"}}`); verifier != nil {
		t.Fatal("production enabled the E2E session verifier")
	}
	if verifier := NewE2ESessionVerifier("development", "true", `{"hosted":{"subject":"synthetic-user","email":"person@example.test"}}`); verifier != nil {
		t.Fatal("non-exact E2E flag enabled the verifier")
	}
}

func TestE2ESessionVerifierRequiresTrustedProxyAndSessionCookie(t *testing.T) {
	verifier := NewE2ESessionVerifier("development", "1", `{"hosted":{"subject":"synthetic-user","email":"Person@Example.test"}}`)
	if verifier == nil {
		t.Fatal("expected development E2E verifier")
	}
	for _, credentials := range []identityapp.SessionCredentials{
		{CookieHeader: e2eSessionCookieName + "=hosted"},
		{CookieHeader: e2eSessionCookieName + "=hosted", TrustedProxy: true, AuthorizationPresent: true},
		{CookieHeader: e2eSessionCookieName + "=unknown", TrustedProxy: true},
	} {
		principal, err := verifier.Verify(context.Background(), credentials, identityapp.AssuranceActiveSession)
		if err != nil || principal != nil {
			t.Errorf("unexpected principal=%#v err=%v for credentials %#v", principal, err, credentials)
		}
	}
	principal, err := verifier.Verify(context.Background(), identityapp.SessionCredentials{
		CookieHeader: e2eSessionCookieName + "=hosted",
		TrustedProxy: true,
	}, identityapp.AssuranceFreshProvider)
	if err != nil || principal == nil {
		t.Fatalf("Verify() = %#v, %v", principal, err)
	}
	if principal.Issuer != "e2e" || principal.Subject != "synthetic-user" || principal.Email != "person@example.test" || !principal.EmailVerified || principal.Assurance != identityapp.AssuranceActiveSession || principal.SessionID != "e2e:hosted" {
		t.Fatalf("unexpected E2E principal: %#v", principal)
	}
}

func TestE2ESessionVerifierRejectsInvalidConfigurationEntries(t *testing.T) {
	verifier := NewE2ESessionVerifier("development", "1", `{
		"valid-alias":{"subject":"synthetic-user:1","email":"person@example.test","emailVerified":false},
		"InvalidAlias":{"subject":"synthetic-user","email":"person@example.test"},
		"invalid-subject":{"subject":"Synthetic User","email":"person@example.test"},
		"invalid-email":{"subject":"synthetic-user","email":"bad@example"},
		"not-an-object":null
	}`)
	if verifier == nil {
		t.Fatal("expected development E2E verifier")
	}
	if len(verifier.sessions) != 1 {
		t.Fatalf("accepted %d E2E sessions; want one", len(verifier.sessions))
	}
	principal, err := verifier.Verify(context.Background(), identityapp.SessionCredentials{CookieHeader: e2eSessionCookieName + "=valid-alias", TrustedProxy: true}, identityapp.AssuranceActiveSession)
	if err != nil || principal == nil || principal.EmailVerified {
		t.Fatalf("expected configured unverified E2E principal, got %#v err=%v", principal, err)
	}
}

func TestE2ESessionVerifierBoundsConfigurationInput(t *testing.T) {
	verifier := NewE2ESessionVerifier("development", "1", strings.Repeat(" ", 16_385))
	if len(verifier.sessions) != 0 {
		t.Fatalf("oversized E2E config created %d sessions", len(verifier.sessions))
	}
}
