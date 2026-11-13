package config

import (
	"errors"
	"net/url"
	"strings"
	"unicode/utf16"
)

// ValidateProductionDeployment checks deployment secrets and runtime configuration
// without opening a database connection or exposing secret values in errors.
func ValidateProductionDeployment(environment Environment) error {
	var failures []string
	validateProductionOrigin("WEB_ORIGIN", environment.WebOrigin, &failures)
	validateProductionSecret("PROXY_SECRET", environment.ProxySecret, &failures)
	validateProductionSecret("CRON_SECRET", environment.CronSecret, &failures)
	if strings.TrimSpace(environment.DatabaseURL) == "" {
		failures = append(failures, "DATABASE_URL is required in production.")
	}
	if strings.TrimSpace(environment.E2EBrowserTests) == "1" || strings.TrimSpace(environment.E2EBrowserTestUsers) != "" {
		failures = append(failures, "E2E_BROWSER_TESTS and E2E_BROWSER_TEST_USERS are not allowed in production.")
	}
	if len(failures) != 0 {
		return errors.New(strings.Join(failures, " "))
	}
	return nil
}

func validateProductionSecret(name, value string, failures *[]string) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		*failures = append(*failures, name+" is required in production.")
		return
	}
	if len(utf16.Encode([]rune(trimmed))) < 32 {
		*failures = append(*failures, name+" must contain at least 32 characters.")
	}
}

func validateProductionOrigin(name, value string, failures *[]string) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		*failures = append(*failures, name+" is required in production.")
		return
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed == nil || parsed.Hostname() == "" || parsed.User != nil ||
		(parsed.Path != "" && parsed.Path != "/") || parsed.RawQuery != "" || parsed.Fragment != "" {
		*failures = append(*failures, name+" must contain only an origin.")
		return
	}
	if parsed.Scheme != "https" {
		*failures = append(*failures, name+" must use HTTPS in production.")
	}
}
