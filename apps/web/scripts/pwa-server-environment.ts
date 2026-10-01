const ISOLATED_SERVER_ENVIRONMENT_KEYS = [
  "DATABASE_URL",
  "DIRECT_URL",
  "POSTGRES_DB",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "API_ORIGIN",
  "API_PROXY_SECRET",
  "PROXY_SECRET",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_REQUIRE_TLS",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "SMTP_TLS_CA",
  "AUTH_MAGIC_LINK_SECRET",
  "AUTH_TRUST_PROXY_HEADERS",
  "TURNSTILE_SECRET_KEY",
  "CRON_SECRET",
  "PASSKEY_ORIGIN",
  "PASSKEY_RP_ID",
  "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN",
  "NEXT_PUBLIC_POSTHOG_HOST",
  "NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "E2E_BROWSER_TESTS",
  "E2E_BROWSER_TEST_USERS",
  "NEXT_PUBLIC_E2E_BROWSER_TESTS",
] as const;

export function createPwaServerEnvironment(
  parentEnvironment: Readonly<Record<string, string | undefined>>,
  browserTestOrigin: string,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(parentEnvironment)) {
    if (value !== undefined) environment[name] = value;
  }

  // Playwright merges webServer.env with process.env, so blank sensitive values explicitly.
  for (const name of ISOLATED_SERVER_ENVIRONMENT_KEYS) environment[name] = "";
  Object.assign(environment, {
    AUTH_BACKEND: "passwordless",
    AUTH_APP_ORIGIN: browserTestOrigin,
    AUTH_SESSION_SECRET: "browser-pwa-session-secret-12345678901234567890",
    WEB_ORIGIN: browserTestOrigin,
    AUTH_TRUST_PROXY_HEADERS: "false",
    NEXT_TELEMETRY_DISABLED: "1",
  });
  return environment;
}
