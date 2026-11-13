package config

import (
	"errors"
	"os"
	"strconv"
	"strings"
)

const DefaultPort = 8787

type LookupEnv func(string) (string, bool)

type Environment struct {
	DatabaseURL      string
	Port             int
	NodeEnvironment  string
	DeploymentTarget string

	WebOrigin   string
	ProxySecret string
	CronSecret  string

	AuthBackend         string
	AuthAppOrigin       string
	AuthMagicLinkSecret string
	AuthSessionSecret   string
	TurnstileSecretKey  string
	AuthMagicLinkTTL    string
	AuthAccessTokenTTL  string
	AuthRefreshTokenTTL string

	SMTPHost          string
	SMTPPort          string
	SMTPSecure        string
	SMTPRequireTLS    *string
	SMTPUser          string
	SMTPPassword      string
	SMTPTLSCA         string
	AuthEmailFrom     string
	AuthEmailFromName *string

	PasskeyRPID         string
	PasskeyOrigin       string
	E2EBrowserTests     string
	E2EBrowserTestUsers string
}

func FromProcess() (Environment, error) {
	return ReadEnvironment(os.LookupEnv)
}

func ReadEnvironment(lookup LookupEnv) (Environment, error) {
	if lookup == nil {
		return Environment{}, errors.New("environment lookup is required")
	}
	read := func(name string) string {
		value, _ := lookup(name)
		return value
	}
	optional := func(name string) *string {
		value, ok := lookup(name)
		if !ok {
			return nil
		}
		return &value
	}

	port := DefaultPort
	if value, ok := lookup("PORT"); ok {
		parsed, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil || parsed < 1 || parsed > 65_535 {
			return Environment{}, errors.New("PORT must be an integer between 1 and 65535")
		}
		port = parsed
	}

	return Environment{
		DatabaseURL:         read("DATABASE_URL"),
		Port:                port,
		NodeEnvironment:     read("NODE_ENV"),
		DeploymentTarget:    read("DEPLOYMENT_TARGET"),
		WebOrigin:           read("WEB_ORIGIN"),
		ProxySecret:         read("PROXY_SECRET"),
		CronSecret:          read("CRON_SECRET"),
		AuthBackend:         read("AUTH_BACKEND"),
		AuthAppOrigin:       read("AUTH_APP_ORIGIN"),
		AuthMagicLinkSecret: read("AUTH_MAGIC_LINK_SECRET"),
		AuthSessionSecret:   read("AUTH_SESSION_SECRET"),
		TurnstileSecretKey:  read("TURNSTILE_SECRET_KEY"),
		AuthMagicLinkTTL:    read("AUTH_MAGIC_LINK_TTL_SECONDS"),
		AuthAccessTokenTTL:  read("AUTH_ACCESS_TOKEN_TTL_SECONDS"),
		AuthRefreshTokenTTL: read("AUTH_REFRESH_TOKEN_TTL_SECONDS"),
		SMTPHost:            read("SMTP_HOST"),
		SMTPPort:            read("SMTP_PORT"),
		SMTPSecure:          read("SMTP_SECURE"),
		SMTPRequireTLS:      optional("SMTP_REQUIRE_TLS"),
		SMTPUser:            read("SMTP_USER"),
		SMTPPassword:        read("SMTP_PASSWORD"),
		SMTPTLSCA:           read("SMTP_TLS_CA"),
		AuthEmailFrom:       read("AUTH_EMAIL_FROM"),
		AuthEmailFromName:   optional("AUTH_EMAIL_FROM_NAME"),
		PasskeyRPID:         read("PASSKEY_RP_ID"),
		PasskeyOrigin:       read("PASSKEY_ORIGIN"),
		E2EBrowserTests:     read("E2E_BROWSER_TESTS"),
		E2EBrowserTestUsers: read("E2E_BROWSER_TEST_USERS"),
	}, nil
}

func (environment Environment) RequireDatabaseURL() (string, error) {
	value := strings.TrimSpace(environment.DatabaseURL)
	if value == "" {
		return "", errors.New("DATABASE_URL is required for the API runtime")
	}
	return value, nil
}
