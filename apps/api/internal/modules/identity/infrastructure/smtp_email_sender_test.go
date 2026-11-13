package infrastructure

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"mime"
	"net/mail"
	"net/url"
	"os"
	"strings"
	"testing"
)

func stringPointer(value string) *string {
	return &value
}

func validSMTPEnvironment() SMTPEnvironment {
	return SMTPEnvironment{
		Host:        "smtp.example.test",
		Port:        "587",
		Production:  true,
		Secure:      "false",
		RequireTLS:  stringPointer("true"),
		Username:    "smtp-user",
		Password:    "smtp-password",
		FromAddress: "no-reply@example.test",
		FromName:    stringPointer("rhasia-scret"),
	}
}

func TestReadSMTPConfiguration(t *testing.T) {
	t.Run("reads STARTTLS configuration", func(t *testing.T) {
		configuration, err := ReadSMTPConfiguration(validSMTPEnvironment())
		if err != nil {
			t.Fatalf("read SMTP configuration: %v", err)
		}
		if configuration.Host != "smtp.example.test" || configuration.Port != 587 || configuration.Secure || !configuration.RequireTLS || configuration.Username != "smtp-user" || configuration.Password != "smtp-password" || configuration.From.Address != "no-reply@example.test" || configuration.From.Name != "rhasia-scret" {
			t.Fatalf("unexpected SMTP configuration: %#v", configuration)
		}
	})

	t.Run("defaults STARTTLS requirement and display name only when omitted", func(t *testing.T) {
		environment := validSMTPEnvironment()
		environment.RequireTLS = nil
		environment.FromName = nil
		configuration, err := ReadSMTPConfiguration(environment)
		if err != nil {
			t.Fatalf("read SMTP configuration: %v", err)
		}
		if !configuration.RequireTLS || configuration.From.Name != "rhasia-scret" {
			t.Fatalf("unexpected defaults: %#v", configuration)
		}
		environment.RequireTLS = stringPointer("")
		if _, err := ReadSMTPConfiguration(environment); err == nil || !strings.Contains(err.Error(), "SMTP_REQUIRE_TLS") {
			t.Fatalf("expected empty SMTP_REQUIRE_TLS to fail, got %v", err)
		}
		environment.RequireTLS = nil
		environment.FromName = stringPointer("")
		if _, err := ReadSMTPConfiguration(environment); err == nil || !strings.Contains(err.Error(), "AUTH_EMAIL_FROM_NAME") {
			t.Fatalf("expected empty sender name to fail, got %v", err)
		}
	})

	t.Run("requires implicit TLS on port 465", func(t *testing.T) {
		environment := validSMTPEnvironment()
		environment.Port = "465"
		if _, err := ReadSMTPConfiguration(environment); err == nil || !strings.Contains(err.Error(), "SMTP_PORT 465") {
			t.Fatalf("expected secure-port mismatch, got %v", err)
		}
		environment.Secure = "true"
		configuration, err := ReadSMTPConfiguration(environment)
		if err != nil || !configuration.Secure {
			t.Fatalf("expected implicit TLS configuration, got %#v, %v", configuration, err)
		}
	})

	t.Run("allows custom STARTTLS ports outside production", func(t *testing.T) {
		environment := validSMTPEnvironment()
		environment.Production = false
		environment.Port = "2525"
		configuration, err := ReadSMTPConfiguration(environment)
		if err != nil {
			t.Fatalf("read local SMTP configuration: %v", err)
		}
		if configuration.Port != 2525 || configuration.Production || configuration.Secure || !configuration.RequireTLS {
			t.Fatalf("unexpected local SMTP policy: %#v", configuration)
		}
		if _, err := NewSMTPEmailSender(configuration); err != nil {
			t.Fatalf("create local STARTTLS sender: %v", err)
		}
		environment.RequireTLS = stringPointer("false")
		if _, err := ReadSMTPConfiguration(environment); err == nil || !strings.Contains(err.Error(), "SMTP_REQUIRE_TLS") {
			t.Fatalf("expected non-production custom SMTP port to require STARTTLS, got %v", err)
		}
	})

	tests := []struct {
		name        string
		mutate      func(*SMTPEnvironment)
		wantMessage string
	}{
		{name: "rejects port zero", mutate: func(environment *SMTPEnvironment) { environment.Port = "0" }, wantMessage: "SMTP_PORT"},
		{name: "rejects non-decimal port", mutate: func(environment *SMTPEnvironment) { environment.Port = "587.5" }, wantMessage: "SMTP_PORT"},
		{name: "rejects missing SMTP secure value", mutate: func(environment *SMTPEnvironment) { environment.Secure = "" }, wantMessage: "SMTP_SECURE"},
		{name: "requires TLS for STARTTLS", mutate: func(environment *SMTPEnvironment) { environment.RequireTLS = stringPointer("false") }, wantMessage: "SMTP_REQUIRE_TLS"},
		{name: "rejects port 25", mutate: func(environment *SMTPEnvironment) { environment.Port = "25" }, wantMessage: "SMTP_PORT 25"},
		{name: "rejects unapproved port", mutate: func(environment *SMTPEnvironment) { environment.Port = "2525" }, wantMessage: "SMTP_PORT 2525"},
		{name: "rejects unapproved port in production", mutate: func(environment *SMTPEnvironment) {
			environment.Port = "1025"
		}, wantMessage: "SMTP_PORT 1025"},
		{name: "rejects host whitespace", mutate: func(environment *SMTPEnvironment) { environment.Host = "smtp\u00a0host" }, wantMessage: "SMTP_HOST"},
		{name: "rejects newline sender name", mutate: func(environment *SMTPEnvironment) { environment.FromName = stringPointer("unsafe\nname") }, wantMessage: "AUTH_EMAIL_FROM_NAME"},
		{name: "rejects malformed sender", mutate: func(environment *SMTPEnvironment) { environment.FromAddress = "bad\n@example.test" }, wantMessage: "AUTH_EMAIL_FROM"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			environment := validSMTPEnvironment()
			test.mutate(&environment)
			_, err := ReadSMTPConfiguration(environment)
			if err == nil || !strings.Contains(err.Error(), test.wantMessage) {
				t.Fatalf("expected error containing %q, got %v", test.wantMessage, err)
			}
		})
	}

	t.Run("accepts bounded base64 PEM material and rejects malformed values", func(t *testing.T) {
		certificate := "-----BEGIN CERTIFICATE-----\nsynthetic-certificate\n-----END CERTIFICATE-----\n"
		environment := validSMTPEnvironment()
		environment.TLSCA = base64.StdEncoding.EncodeToString([]byte(certificate))
		configuration, err := ReadSMTPConfiguration(environment)
		if err != nil || string(configuration.TLSCA) != certificate {
			t.Fatalf("read synthetic PEM: %v; got %q", err, configuration.TLSCA)
		}
		environment.TLSCA = "not-base64"
		if _, err := ReadSMTPConfiguration(environment); err == nil || !strings.Contains(err.Error(), "SMTP_TLS_CA") {
			t.Fatalf("expected invalid CA to fail, got %v", err)
		}
	})
}

func TestNewSMTPEmailSenderRejectsUnsupportedPort(t *testing.T) {
	environment := validSMTPEnvironment()
	configuration, err := ReadSMTPConfiguration(environment)
	if err != nil {
		t.Fatalf("read valid SMTP configuration: %v", err)
	}
	configuration.Port = 2525
	if _, err := NewSMTPEmailSender(configuration); err == nil || !strings.Contains(err.Error(), "SMTP TLS policy") {
		t.Fatalf("expected unsupported direct configuration to fail, got %v", err)
	}
}

func TestRenderMagicLinkMessage(t *testing.T) {
	token := "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK"
	link, err := url.Parse("https://auth.example.test/auth/pwa-confirm#token=" + token + "&next=%2Fvaults&handoff=abcdefghijklmnop")
	if err != nil {
		t.Fatalf("parse synthetic action URL: %v", err)
	}
	if !isSafeMagicLinkURL(link) {
		t.Fatal("expected a valid PWA action URL")
	}
	message, err := renderMagicLinkMessage(mail.Address{Name: "rhasia-scret", Address: "no-reply@example.test"}, "person@example.test", link.String())
	if err != nil {
		t.Fatalf("render email: %v", err)
	}
	text := string(message)
	for _, expected := range []string{
		`From: "rhasia-scret" <no-reply@example.test>`,
		"To: <person@example.test>",
		"rhasia-scret sign-in link",
		"Sign in to rhasia-scret",
		"Use the button below to sign in or create your hosted account.",
		"If the button does not work, open this link:",
		"abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK",
		"Content-Type: multipart/alternative;",
		"text/plain; charset=utf-8",
		"text/html; charset=utf-8",
	} {
		if !strings.Contains(text, expected) {
			t.Errorf("email missing expected content %q", expected)
		}
	}
	content := renderMagicLinkEmail(link.String())
	if !strings.Contains(content.Text, link.String()) || !strings.Contains(content.HTML, "&amp;next=%2Fvaults&amp;handoff=abcdefghijklmnop") {
		t.Error("rendered email does not preserve the text link and escape HTML fragment delimiters")
	}
	if strings.Contains(text, "application/qr") {
		t.Error("email unexpectedly contains non-email payload material")
	}
}

func TestMagicLinkEmailMatchesSharedSyntheticGolden(t *testing.T) {
	fixtureBytes, err := os.ReadFile("../../../../../../packages/api-contract/test-fixtures/email-golden.json")
	if err != nil {
		t.Fatalf("read shared email golden fixture: %v", err)
	}
	var fixture struct {
		MagicLink struct {
			Subject string `json:"subject"`
			Text    string `json:"text"`
			HTML    string `json:"html"`
		} `json:"magicLink"`
	}
	if err := json.Unmarshal(fixtureBytes, &fixture); err != nil {
		t.Fatalf("decode shared email golden fixture: %v", err)
	}
	link, err := url.Parse("https://vault.example.test/auth/pwa-confirm#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK&next=%2Fvaults&handoff=abcdefghijklmnop")
	if err != nil {
		t.Fatalf("parse synthetic action URL: %v", err)
	}
	actual := renderMagicLinkEmail(link.String())
	if actual.Subject != fixture.MagicLink.Subject || actual.Text != fixture.MagicLink.Text || actual.HTML != fixture.MagicLink.HTML {
		t.Fatal("Go magic-link email differs from the shared TypeScript rendering fixture")
	}
}

func TestMagicLinkURLValidation(t *testing.T) {
	token := "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK"
	valid := "https://auth.example.test/auth/confirm#token=" + token + "&next=%2Fvaults"
	invalid := []string{
		"https://auth.example.test/auth/other#token=" + token,
		"https://auth.example.test/auth/confirm?token=" + token,
		"https://auth.example.test/auth/confirm#token=" + token + "&token=" + token,
		"https://auth.example.test/auth/confirm#token=" + token + "&handoff=abcdefghijklmnop",
		"http://auth.example.test/auth/confirm#token=" + token,
		"https:///auth/confirm#token=" + token,
	}
	parsed, err := url.Parse(valid)
	if err != nil || !isSafeMagicLinkURL(parsed) {
		t.Fatalf("expected valid browser link, got %v", err)
	}
	for _, raw := range invalid {
		parsed, err := url.Parse(raw)
		if err != nil {
			continue
		}
		if isSafeMagicLinkURL(parsed) {
			t.Errorf("accepted unsafe magic-link URL %q", raw)
		}
	}
}

func TestSMTPEmailSenderRejectsInvalidLinkBeforeNetworking(t *testing.T) {
	configuration, err := ReadSMTPConfiguration(validSMTPEnvironment())
	if err != nil {
		t.Fatalf("read SMTP configuration: %v", err)
	}
	sender, err := NewSMTPEmailSender(configuration)
	if err != nil {
		t.Fatalf("create sender: %v", err)
	}
	err = sender.SendMagicLink(context.Background(), "person@example.test", &url.URL{Scheme: "https", Host: "auth.example.test", Path: "/auth/confirm"})
	if err == nil || !strings.Contains(err.Error(), "invalid") {
		t.Fatalf("expected invalid link error, got %v", err)
	}
}

func TestMagicLinkSubjectUsesSafeHeaderEncoding(t *testing.T) {
	encoded := mime.QEncoding.Encode("UTF-8", "rhasia-scret sign-in link")
	if strings.ContainsAny(encoded, "\r\n") {
		t.Fatalf("unexpected subject header characters: %q", encoded)
	}
}
