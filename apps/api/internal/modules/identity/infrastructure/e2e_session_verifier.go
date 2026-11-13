package infrastructure

import (
	"context"
	"encoding/json"
	"strings"
	"unicode"
	"unicode/utf16"

	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity/application"
)

const e2eSessionCookieName = "rhsia-e2e-session"

type e2eConfiguredSession struct {
	subject       string
	email         string
	emailVerified bool
}

type E2ESessionVerifier struct {
	sessions map[string]e2eConfiguredSession
}

func NewE2ESessionVerifier(nodeEnvironment string, enabled string, configuredUsers string) *E2ESessionVerifier {
	if nodeEnvironment != "development" || enabled != "1" {
		return nil
	}
	return &E2ESessionVerifier{sessions: parseE2EConfiguredSessions(configuredUsers)}
}

func (verifier *E2ESessionVerifier) Verify(_ context.Context, credentials identityapp.SessionCredentials, minimum identityapp.SessionAssurance) (*identityapp.Principal, error) {
	if credentials.AuthorizationPresent || !credentials.TrustedProxy {
		return nil, nil
	}
	alias := readE2ESessionCookie(credentials.CookieHeader)
	configured, ok := verifier.sessions[alias]
	if !ok {
		return nil, nil
	}
	principal := &identityapp.Principal{
		Issuer:        "e2e",
		Subject:       configured.subject,
		Email:         configured.email,
		EmailVerified: configured.emailVerified,
		Assurance:     identityapp.AssuranceActiveSession,
		SessionID:     "e2e:" + alias,
	}
	if !identityapp.AssuranceSatisfies(principal.Assurance, minimum) {
		return nil, nil
	}
	return principal, nil
}

func parseE2EConfiguredSessions(raw string) map[string]e2eConfiguredSession {
	sessions := make(map[string]e2eConfiguredSession)
	if raw == "" || e2eUTF16Length(raw) > 16_384 {
		return sessions
	}
	var values map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &values); err != nil || values == nil {
		return sessions
	}
	for alias, rawValue := range values {
		if !isSafeE2EAlias(alias) {
			continue
		}
		var candidate map[string]json.RawMessage
		if err := json.Unmarshal(rawValue, &candidate); err != nil || candidate == nil {
			continue
		}
		var subject string
		if err := json.Unmarshal(candidate["subject"], &subject); err != nil || !isSafeE2ESubject(subject) {
			continue
		}
		var email string
		if err := json.Unmarshal(candidate["email"], &email); err != nil || !isSimpleEmail(email) || e2eUTF16Length(email) > 254 {
			continue
		}
		emailVerified := true
		if rawVerified, ok := candidate["emailVerified"]; ok && string(rawVerified) == "false" {
			emailVerified = false
		}
		sessions[alias] = e2eConfiguredSession{subject: subject, email: strings.ToLower(email), emailVerified: emailVerified}
	}
	return sessions
}

func readE2ESessionCookie(header string) string {
	for _, pair := range strings.Split(header, ";") {
		name, value, found := strings.Cut(strings.TrimSpace(pair), "=")
		if found && name == e2eSessionCookieName {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func isSafeE2EAlias(value string) bool {
	if len(value) < 1 || len(value) > 80 {
		return false
	}
	for _, character := range value {
		if !(character >= 'a' && character <= 'z') && !(character >= '0' && character <= '9') && character != '-' {
			return false
		}
	}
	return true
}

func isSafeE2ESubject(value string) bool {
	if len(value) < 1 || len(value) > 128 {
		return false
	}
	for _, character := range value {
		if !(character >= 'a' && character <= 'z') && !(character >= '0' && character <= '9') && character != ':' && character != '-' {
			return false
		}
	}
	return true
}

func isSimpleEmail(value string) bool {
	if value == "" {
		return false
	}
	at := strings.LastIndexByte(value, '@')
	if at <= 0 || at >= len(value)-1 || strings.IndexByte(value[:at], '@') >= 0 {
		return false
	}
	for _, character := range value {
		if unicode.IsSpace(character) || character <= 0x1f || character == 0x7f {
			return false
		}
	}
	dot := strings.LastIndexByte(value[at+1:], '.')
	return dot > 0 && dot < len(value[at+1:])-1
}

func e2eUTF16Length(value string) int {
	return len(utf16.Encode([]rune(value)))
}

var _ identityapp.SessionVerifier = (*E2ESessionVerifier)(nil)
