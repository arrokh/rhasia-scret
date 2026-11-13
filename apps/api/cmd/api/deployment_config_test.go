package main

import (
	"strings"
	"testing"
)

func TestVerifyDeploymentConfigurationAcceptsLocalNoneBackend(t *testing.T) {
	t.Parallel()

	values := map[string]string{
		"NODE_ENV":     "development",
		"AUTH_BACKEND": "none",
		"WEB_ORIGIN":   "http://localhost:3000",
		"DATABASE_URL": "postgresql://synthetic:synthetic@127.0.0.1:5432/synthetic?schema=public",
	}
	if err := verifyDeploymentConfiguration(lookupConfiguration(values)); err != nil {
		t.Fatalf("verifyDeploymentConfiguration(): %v", err)
	}
}

func TestVerifyDeploymentConfigurationRequiresProductionSettings(t *testing.T) {
	t.Parallel()

	values := map[string]string{
		"NODE_ENV": "production",
	}
	err := verifyDeploymentConfiguration(lookupConfiguration(values))
	if err == nil {
		t.Fatal("verifyDeploymentConfiguration() succeeded without production settings")
	}
	for _, name := range []string{"WEB_ORIGIN", "PROXY_SECRET", "CRON_SECRET", "DATABASE_URL", "AUTH_BACKEND"} {
		if !strings.Contains(err.Error(), name) {
			t.Errorf("error %q does not identify missing setting %s", err, name)
		}
	}
}

func TestVerifyDeploymentConfigurationRejectsProductionNoneBackend(t *testing.T) {
	t.Parallel()

	values := map[string]string{
		"NODE_ENV":          "production",
		"DEPLOYMENT_TARGET": "vercel",
		"AUTH_BACKEND":      "none",
		"WEB_ORIGIN":        "https://web.example.test",
		"PROXY_SECRET":      strings.Repeat("p", 32),
		"CRON_SECRET":       strings.Repeat("c", 32),
		"DATABASE_URL":      "postgresql://synthetic:synthetic@db.example.test:5432/synthetic?schema=public",
		"AUTH_APP_ORIGIN":   "https://auth.example.test",
	}
	if err := verifyDeploymentConfiguration(lookupConfiguration(values)); err == nil || !strings.Contains(err.Error(), "AUTH_BACKEND=none") {
		t.Fatalf("verifyDeploymentConfiguration() error=%v; want production disabled-backend rejection", err)
	}
}

func TestVerifyDeploymentConfigurationAcceptsSelfHostedProductionNoneBackend(t *testing.T) {
	t.Parallel()

	values := map[string]string{
		"NODE_ENV":          "production",
		"DEPLOYMENT_TARGET": "selfhosted",
		"AUTH_BACKEND":      "none",
		"WEB_ORIGIN":        "https://web.example.test",
		"PROXY_SECRET":      strings.Repeat("p", 32),
		"CRON_SECRET":       strings.Repeat("c", 32),
		"DATABASE_URL":      "postgresql://synthetic:synthetic@db.example.test:5432/synthetic?schema=public",
	}
	if err := verifyDeploymentConfiguration(lookupConfiguration(values)); err != nil {
		t.Fatalf("verifyDeploymentConfiguration(): %v", err)
	}
}

func TestVerifyDeploymentConfigurationDoesNotRequireDirectURL(t *testing.T) {
	t.Parallel()

	values := validProductionDeploymentConfiguration()
	if err := verifyDeploymentConfiguration(lookupConfiguration(values)); err != nil {
		t.Fatalf("verifyDeploymentConfiguration(): %v", err)
	}
}

func TestVerifyDeploymentConfigurationEnforcesProductionSMTPPolicyForProductionTarget(t *testing.T) {
	t.Parallel()

	values := validProductionDeploymentConfiguration()
	values["NODE_ENV"] = "development"
	values["VERIFY_DEPLOYMENT_PRODUCTION"] = "1"
	values["SMTP_PORT"] = "2525"
	if err := verifyDeploymentConfiguration(lookupConfiguration(values)); err == nil || !strings.Contains(err.Error(), "authentication or SMTP configuration is invalid") {
		t.Fatalf("verifyDeploymentConfiguration() error = %v, want production SMTP port rejection", err)
	}
}

func TestVerifyDeploymentConfigurationEnforcesProductionTurnstilePolicyForProductionTarget(t *testing.T) {
	t.Parallel()

	values := validProductionDeploymentConfiguration()
	values["NODE_ENV"] = "development"
	values["VERIFY_DEPLOYMENT_PRODUCTION"] = "1"
	values["TURNSTILE_SECRET_KEY"] = "1x0000000000000000000000000000000AA"
	if err := verifyDeploymentConfiguration(lookupConfiguration(values)); err == nil || !strings.Contains(err.Error(), "authentication or SMTP configuration is invalid") {
		t.Fatalf("verifyDeploymentConfiguration() error = %v, want production Turnstile policy rejection", err)
	}
}

func TestVerifyDeploymentConfigurationRejectsE2EIdentityConfigurationForProductionTarget(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name  string
		key   string
		value string
	}{
		{name: "enabled E2E sessions", key: "E2E_BROWSER_TESTS", value: "1"},
		{name: "configured E2E identities", key: "E2E_BROWSER_TEST_USERS", value: `{"synthetic":{"subject":"synthetic-user","email":"user@example.test"}}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			values := validProductionDeploymentConfiguration()
			values["NODE_ENV"] = "development"
			values["VERIFY_DEPLOYMENT_PRODUCTION"] = "1"
			values[test.key] = test.value
			if err := verifyDeploymentConfiguration(lookupConfiguration(values)); err == nil || !strings.Contains(err.Error(), "E2E_BROWSER_TESTS and E2E_BROWSER_TEST_USERS are not allowed in production") {
				t.Fatalf("verifyDeploymentConfiguration() error = %v, want production E2E configuration rejection", err)
			}
		})
	}
}

func validProductionDeploymentConfiguration() map[string]string {
	return map[string]string{
		"NODE_ENV":               "production",
		"AUTH_BACKEND":           "passwordless",
		"WEB_ORIGIN":             "https://web.example.test",
		"PROXY_SECRET":           strings.Repeat("p", 32),
		"CRON_SECRET":            strings.Repeat("c", 32),
		"DATABASE_URL":           "postgresql://synthetic:synthetic@db.example.test:5432/synthetic?schema=public",
		"AUTH_APP_ORIGIN":        "https://auth.example.test",
		"AUTH_MAGIC_LINK_SECRET": strings.Repeat("m", 32),
		"AUTH_SESSION_SECRET":    strings.Repeat("s", 32),
		"TURNSTILE_SECRET_KEY":   "synthetic-turnstile-secret",
		"SMTP_HOST":              "mail.example.test",
		"SMTP_PORT":              "587",
		"SMTP_SECURE":            "false",
		"SMTP_USER":              "synthetic-user",
		"SMTP_PASSWORD":          "synthetic-password",
		"AUTH_EMAIL_FROM":        "noreply@example.test",
	}
}

func lookupConfiguration(values map[string]string) func(string) (string, bool) {
	return func(key string) (string, bool) {
		value, ok := values[key]
		return value, ok
	}
}
