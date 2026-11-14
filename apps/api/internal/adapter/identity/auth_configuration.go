package infrastructure

import (
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf16"

	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/identity"
)

const (
	defaultMagicLinkTTLSeconds    = 900
	defaultAccessTokenTTLSeconds  = 900
	defaultRefreshTokenTTLSeconds = 2_592_000
)

var ErrAuthenticationConfiguration = errors.New("authentication configuration is invalid")

type AuthBackend string

const (
	AuthBackendNone         AuthBackend = "none"
	AuthBackendPasswordless AuthBackend = "passwordless"
)

type AuthEnvironment struct {
	AuthBackend            string
	NodeEnvironment        string
	DeploymentTarget       string
	WebOrigin              string
	AuthAppOrigin          string
	MagicLinkSecret        string
	SessionSecret          string
	TurnstileSecretKey     string
	MagicLinkTTLSeconds    string
	AccessTokenTTLSeconds  string
	RefreshTokenTTLSeconds string
}

type AuthConfiguration struct {
	Backend      AuthBackend
	Passwordless *identityapp.PasswordlessConfiguration
	Turnstile    TurnstileConfiguration
}

func ReadAuthConfiguration(environment AuthEnvironment) (configuration AuthConfiguration, err error) {
	defer func() {
		if err != nil {
			err = fmt.Errorf("%w: %v", ErrAuthenticationConfiguration, err)
		}
	}()

	backend := strings.TrimSpace(environment.AuthBackend)
	if backend == "" {
		if environment.NodeEnvironment == "production" {
			return AuthConfiguration{}, errors.New("AUTH_BACKEND must be set explicitly in production")
		}
		backend = string(AuthBackendPasswordless)
	}
	if backend == string(AuthBackendNone) {
		deploymentTarget := strings.TrimSpace(environment.DeploymentTarget)
		if environment.NodeEnvironment == "production" && deploymentTarget != "selfhosted" {
			return AuthConfiguration{}, errors.New("AUTH_BACKEND=none is allowed only for the self-hosted local-only target")
		}
		return AuthConfiguration{Backend: AuthBackendNone}, nil
	}
	if backend != string(AuthBackendPasswordless) {
		return AuthConfiguration{}, errors.New("AUTH_BACKEND must be none or passwordless")
	}
	appOrigin, err := readAuthOrigin(environment.AuthAppOrigin)
	if err != nil {
		return AuthConfiguration{}, err
	}
	if environment.NodeEnvironment == "production" && appOrigin.Scheme != "https" {
		return AuthConfiguration{}, errors.New("AUTH_APP_ORIGIN must use HTTPS in production")
	}
	magicLinkSecret := strings.TrimSpace(environment.MagicLinkSecret)
	sessionSecret := strings.TrimSpace(environment.SessionSecret)
	if utf16Length(magicLinkSecret) < 32 {
		return AuthConfiguration{}, errors.New("AUTH_MAGIC_LINK_SECRET must contain at least 32 characters")
	}
	if utf16Length(sessionSecret) < 32 {
		return AuthConfiguration{}, errors.New("AUTH_SESSION_SECRET must contain at least 32 characters")
	}
	if magicLinkSecret == sessionSecret {
		return AuthConfiguration{}, errors.New("AUTH_MAGIC_LINK_SECRET and AUTH_SESSION_SECRET must be different values")
	}
	magicLinkTTL, err := readAuthTTL(environment.MagicLinkTTLSeconds, defaultMagicLinkTTLSeconds, 60, 3_600)
	if err != nil {
		return AuthConfiguration{}, err
	}
	accessTTL, err := readAuthTTL(environment.AccessTokenTTLSeconds, defaultAccessTokenTTLSeconds, 60, 86_400)
	if err != nil {
		return AuthConfiguration{}, err
	}
	refreshTTL, err := readAuthTTL(environment.RefreshTokenTTLSeconds, defaultRefreshTokenTTLSeconds, 3_600, 31_536_000)
	if err != nil {
		return AuthConfiguration{}, err
	}
	turnstile, err := ReadTurnstileConfiguration(environment)
	if err != nil {
		return AuthConfiguration{}, err
	}
	passwordless := &identityapp.PasswordlessConfiguration{
		AppOrigin:              appOrigin,
		MagicLinkSecret:        []byte(magicLinkSecret),
		SessionSecret:          []byte(sessionSecret),
		MagicLinkTTLSeconds:    magicLinkTTL,
		AccessTokenTTLSeconds:  accessTTL,
		RefreshTokenTTLSeconds: refreshTTL,
	}
	return AuthConfiguration{Backend: AuthBackendPasswordless, Passwordless: passwordless, Turnstile: turnstile}, nil
}

func ReadTurnstileConfiguration(environment AuthEnvironment) (TurnstileConfiguration, error) {
	secretKey := strings.TrimSpace(environment.TurnstileSecretKey)
	if secretKey == "" {
		return TurnstileConfiguration{}, nil
	}
	if isCloudflareTestingSecret(secretKey) {
		if environment.NodeEnvironment == "production" && !isLocalHTTPSelfHosted(environment.WebOrigin, environment.AuthAppOrigin) {
			return TurnstileConfiguration{}, errors.New("Cloudflare Turnstile testing keys are not allowed in production")
		}
		policy := TurnstilePolicy{Kind: TurnstilePolicySandbox}
		return TurnstileConfiguration{SecretKey: secretKey, Policy: &policy}, nil
	}
	appOrigin, err := readAuthOrigin(environment.AuthAppOrigin)
	if err != nil {
		return TurnstileConfiguration{}, err
	}
	policy := TurnstilePolicy{Kind: TurnstilePolicyStrict, ExpectedAction: "magic_link_request", ExpectedHostname: appOrigin.Hostname()}
	return TurnstileConfiguration{SecretKey: secretKey, Policy: &policy}, nil
}

func readAuthOrigin(raw string) (*url.URL, error) {
	value := strings.TrimSpace(raw)
	parsed, err := url.Parse(value)
	if err != nil || parsed == nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, errors.New("AUTH_APP_ORIGIN must be a valid URL")
	}
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && isLocalhost(parsed.Hostname())) {
		return nil, errors.New("AUTH_APP_ORIGIN must use HTTPS")
	}
	if parsed.Path != "" && parsed.Path != "/" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.User != nil {
		return nil, errors.New("AUTH_APP_ORIGIN must contain only an origin")
	}
	parsed.Path = ""
	parsed.RawQuery = ""
	parsed.Fragment = ""
	parsed.Host = strings.ToLower(parsed.Host)
	if parsed.Scheme == "https" && parsed.Port() == "443" || parsed.Scheme == "http" && parsed.Port() == "80" {
		parsed.Host = parsed.Hostname()
	}
	return parsed, nil
}

func readAuthTTL(raw string, fallback int, minimum int, maximum int) (int, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return fallback, nil
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return 0, fmt.Errorf("passwordless token lifetime is outside its allowed range")
		}
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < minimum || parsed > maximum {
		return 0, errors.New("passwordless token lifetime is outside its allowed range")
	}
	return parsed, nil
}

func isCloudflareTestingSecret(secret string) bool {
	switch secret {
	case "1x0000000000000000000000000000000AA", "2x0000000000000000000000000000000AA", "3x0000000000000000000000000000000AA":
		return true
	default:
		return false
	}
}

func isLocalHTTPSelfHosted(webOrigin string, authAppOrigin string) bool {
	origins := make([]string, 0, 2)
	if strings.TrimSpace(webOrigin) != "" {
		origins = append(origins, strings.TrimSpace(webOrigin))
	}
	if strings.TrimSpace(authAppOrigin) != "" {
		origins = append(origins, strings.TrimSpace(authAppOrigin))
	}
	if len(origins) == 0 {
		return false
	}
	for _, raw := range origins {
		parsed, err := url.Parse(raw)
		if err != nil || parsed.Scheme != "http" || !isLocalhost(parsed.Hostname()) {
			return false
		}
	}
	return true
}

func isLocalhost(hostname string) bool {
	return hostname == "localhost" || hostname == "127.0.0.1"
}

func utf16Length(value string) int {
	return len(utf16.Encode([]rune(value)))
}
