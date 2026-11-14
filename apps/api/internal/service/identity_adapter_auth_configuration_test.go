package service

import (
	"strings"
	"testing"
)

func validAuthEnvironment() AuthEnvironment {
	return AuthEnvironment{
		AuthBackend:        "passwordless",
		NodeEnvironment:    "test",
		WebOrigin:          "https://web.example.test",
		AuthAppOrigin:      "https://auth.example.test",
		MagicLinkSecret:    strings.Repeat("m", 32),
		SessionSecret:      strings.Repeat("s", 32),
		TurnstileSecretKey: "synthetic-turnstile-secret",
	}
}

func TestReadAuthConfiguration(t *testing.T) {
	t.Run("rejects implicit production backend", func(t *testing.T) {
		_, err := ReadAuthConfiguration(AuthEnvironment{NodeEnvironment: "production"})
		if err == nil || !strings.Contains(err.Error(), "AUTH_BACKEND") {
			t.Fatalf("expected explicit production backend error, got %v", err)
		}
	})

	t.Run("defaults to passwordless outside production", func(t *testing.T) {
		environment := validAuthEnvironment()
		environment.AuthBackend = ""
		configuration, err := ReadAuthConfiguration(environment)
		if err != nil {
			t.Fatalf("read configuration: %v", err)
		}
		if configuration.Backend != AuthBackendPasswordless || configuration.Passwordless == nil {
			t.Fatalf("unexpected configuration: %#v", configuration)
		}
		if configuration.Passwordless.MagicLinkTTLSeconds != 900 || configuration.Passwordless.AccessTokenTTLSeconds != 900 || configuration.Passwordless.RefreshTokenTTLSeconds != 2_592_000 {
			t.Fatalf("unexpected default lifetimes: %#v", configuration.Passwordless)
		}
	})

	t.Run("allows disabled authentication outside production without passwordless settings", func(t *testing.T) {
		configuration, err := ReadAuthConfiguration(AuthEnvironment{AuthBackend: "none", NodeEnvironment: "test", TurnstileSecretKey: "invalid-for-passwordless"})
		if err != nil {
			t.Fatalf("read disabled configuration: %v", err)
		}
		if configuration.Backend != AuthBackendNone || configuration.Passwordless != nil || configuration.Turnstile.SecretKey != "" {
			t.Fatalf("unexpected disabled configuration: %#v", configuration)
		}
	})

	t.Run("allows disabled authentication for self-hosted production", func(t *testing.T) {
		configuration, err := ReadAuthConfiguration(AuthEnvironment{
			AuthBackend: "none", NodeEnvironment: "production", DeploymentTarget: " selfhosted ",
		})
		if err != nil {
			t.Fatalf("read local-only configuration: %v", err)
		}
		if configuration.Backend != AuthBackendNone || configuration.Passwordless != nil {
			t.Fatalf("unexpected disabled configuration: %#v", configuration)
		}
	})

	t.Run("rejects disabled authentication in production unless self-hosted", func(t *testing.T) {
		for _, test := range []struct {
			name    string
			nodeEnv string
			target  string
		}{
			{name: "production without a target", nodeEnv: "production"},
			{name: "Vercel production", nodeEnv: "production", target: "vercel"},
			{name: "unknown production target", nodeEnv: "production", target: "unknown"},
		} {
			t.Run(test.name, func(t *testing.T) {
				_, err := ReadAuthConfiguration(AuthEnvironment{
					AuthBackend: "none", NodeEnvironment: test.nodeEnv, DeploymentTarget: test.target,
				})
				if err == nil || !strings.Contains(err.Error(), "AUTH_BACKEND=none") {
					t.Fatalf("expected hosted disabled-backend rejection, got %v", err)
				}
			})
		}
	})

	t.Run("allows disabled authentication in non-production Vercel previews", func(t *testing.T) {
		configuration, err := ReadAuthConfiguration(AuthEnvironment{
			AuthBackend: "none", NodeEnvironment: "test", DeploymentTarget: "vercel",
		})
		if err != nil || configuration.Backend != AuthBackendNone {
			t.Fatalf("read preview configuration = %#v, %v", configuration, err)
		}
	})

	t.Run("normalizes origin and accepts bounded lifetimes", func(t *testing.T) {
		environment := validAuthEnvironment()
		environment.AuthAppOrigin = "HTTPS://AUTH.EXAMPLE.TEST:443/"
		environment.MagicLinkTTLSeconds = "0060"
		configuration, err := ReadAuthConfiguration(environment)
		if err != nil {
			t.Fatalf("read configuration: %v", err)
		}
		if got := configuration.Passwordless.AppOrigin.String(); got != "https://auth.example.test" {
			t.Fatalf("normalized origin = %q", got)
		}
		if configuration.Passwordless.MagicLinkTTLSeconds != 60 {
			t.Fatalf("magic link TTL = %d", configuration.Passwordless.MagicLinkTTLSeconds)
		}
	})

	tests := []struct {
		name        string
		mutate      func(*AuthEnvironment)
		wantMessage string
	}{
		{name: "rejects unsupported backend", mutate: func(environment *AuthEnvironment) { environment.AuthBackend = "oidc" }, wantMessage: "AUTH_BACKEND"},
		{name: "requires HTTPS origin remotely", mutate: func(environment *AuthEnvironment) { environment.AuthAppOrigin = "http://auth.example.test" }, wantMessage: "HTTPS"},
		{name: "rejects localhost auth origin in production", mutate: func(environment *AuthEnvironment) {
			environment.NodeEnvironment = "production"
			environment.AuthAppOrigin = "http://localhost:4000"
		}, wantMessage: "HTTPS in production"},
		{name: "rejects path in app origin", mutate: func(environment *AuthEnvironment) { environment.AuthAppOrigin = "https://auth.example.test/path" }, wantMessage: "only an origin"},
		{name: "rejects credentials in app origin", mutate: func(environment *AuthEnvironment) { environment.AuthAppOrigin = "https://user:pass@auth.example.test" }, wantMessage: "only an origin"},
		{name: "rejects short magic secret", mutate: func(environment *AuthEnvironment) { environment.MagicLinkSecret = "short" }, wantMessage: "AUTH_MAGIC_LINK_SECRET"},
		{name: "rejects short session secret", mutate: func(environment *AuthEnvironment) { environment.SessionSecret = "short" }, wantMessage: "AUTH_SESSION_SECRET"},
		{name: "rejects identical secrets", mutate: func(environment *AuthEnvironment) { environment.SessionSecret = environment.MagicLinkSecret }, wantMessage: "must be different"},
		{name: "rejects low TTL", mutate: func(environment *AuthEnvironment) { environment.MagicLinkTTLSeconds = "59" }, wantMessage: "lifetime"},
		{name: "rejects fractional TTL", mutate: func(environment *AuthEnvironment) { environment.AccessTokenTTLSeconds = "900.5" }, wantMessage: "lifetime"},
		{name: "rejects excessive refresh TTL", mutate: func(environment *AuthEnvironment) { environment.RefreshTokenTTLSeconds = "31536001" }, wantMessage: "lifetime"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			environment := validAuthEnvironment()
			test.mutate(&environment)
			_, err := ReadAuthConfiguration(environment)
			if err == nil || !strings.Contains(err.Error(), test.wantMessage) {
				t.Fatalf("expected error containing %q, got %v", test.wantMessage, err)
			}
		})
	}
}

func TestReadTurnstileConfiguration(t *testing.T) {
	t.Run("leaves verification optional without a secret", func(t *testing.T) {
		configuration, err := ReadTurnstileConfiguration(AuthEnvironment{})
		if err != nil {
			t.Fatalf("read configuration: %v", err)
		}
		if configuration.SecretKey != "" || configuration.Policy != nil {
			t.Fatalf("unexpected configuration: %#v", configuration)
		}
	})

	t.Run("binds strict policy to action and host", func(t *testing.T) {
		environment := validAuthEnvironment()
		configuration, err := ReadTurnstileConfiguration(environment)
		if err != nil {
			t.Fatalf("read configuration: %v", err)
		}
		if configuration.Policy == nil || configuration.Policy.Kind != TurnstilePolicyStrict || configuration.Policy.ExpectedAction != "magic_link_request" || configuration.Policy.ExpectedHostname != "auth.example.test" {
			t.Fatalf("unexpected policy: %#v", configuration.Policy)
		}
	})

	t.Run("allows test keys only for local self-hosted production origins", func(t *testing.T) {
		environment := validAuthEnvironment()
		environment.NodeEnvironment = "production"
		environment.TurnstileSecretKey = "1x0000000000000000000000000000000AA"
		environment.WebOrigin = "http://localhost:3000"
		environment.AuthAppOrigin = "http://localhost:4000"
		configuration, err := ReadTurnstileConfiguration(environment)
		if err != nil {
			t.Fatalf("read local test configuration: %v", err)
		}
		if configuration.Policy == nil || configuration.Policy.Kind != TurnstilePolicySandbox {
			t.Fatalf("unexpected policy: %#v", configuration.Policy)
		}
		environment.WebOrigin = "https://web.example.test"
		if _, err := ReadTurnstileConfiguration(environment); err == nil {
			t.Fatal("expected production test key to be rejected for a remote origin")
		}
	})
}
