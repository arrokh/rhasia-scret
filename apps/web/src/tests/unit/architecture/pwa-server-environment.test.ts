import { describe, expect, it } from "vitest";
import { createPwaServerEnvironment } from "../../../../scripts/pwa-server-environment";

describe("offline PWA server environment", () => {
  it("overrides inherited database, API, delivery, analytics, and E2E secrets", () => {
    const environment = createPwaServerEnvironment(
      {
        PATH: "/synthetic/bin",
        DATABASE_URL: "postgresql://user:secret@db.example.invalid/test",
        DIRECT_URL: "postgresql://user:secret@db.example.invalid/test",
        POSTGRES_DB: "synthetic-database",
        POSTGRES_USER: "synthetic-database-user",
        POSTGRES_PASSWORD: "synthetic-database-password",
        API_ORIGIN: "https://api.example.invalid",
        API_PROXY_SECRET: "synthetic-api-proxy-secret",
        PROXY_SECRET: "synthetic-api-proxy-secret",
        SMTP_HOST: "mail.example.invalid",
        SMTP_PORT: "1025",
        SMTP_SECURE: "true",
        SMTP_REQUIRE_TLS: "true",
        SMTP_USER: "synthetic-smtp-user",
        SMTP_PASSWORD: "synthetic-smtp-password",
        SMTP_TLS_CA: "synthetic-smtp-ca",
        AUTH_MAGIC_LINK_SECRET: "synthetic-magic-link-secret",
        TURNSTILE_SECRET_KEY: "synthetic-turnstile-secret",
        CRON_SECRET: "synthetic-cron-secret",
        PASSKEY_ORIGIN: "https://passkey.example.invalid",
        PASSKEY_RP_ID: "passkey.example.invalid",
        NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "synthetic-analytics-token",
        NEXT_PUBLIC_POSTHOG_HOST: "https://analytics.example.invalid",
        NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN: "synthetic-analytics-token",
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: "synthetic-turnstile-site-key",
        E2E_BROWSER_TESTS: "1",
        E2E_BROWSER_TEST_USERS: "synthetic-test-users",
        NEXT_PUBLIC_E2E_BROWSER_TESTS: "1",
        AUTH_BACKEND: "none",
        AUTH_APP_ORIGIN: "https://auth.example.invalid",
        AUTH_SESSION_SECRET: "synthetic-production-session-secret",
        WEB_ORIGIN: "https://web.example.invalid",
        AUTH_TRUST_PROXY_HEADERS: "true",
      },
      "http://127.0.0.1:3100",
    );

    expect(environment.PATH).toBe("/synthetic/bin");
    for (const name of [
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
    ])
      expect(environment[name]).toBe("");

    expect(environment.AUTH_BACKEND).toBe("passwordless");
    expect(environment.AUTH_APP_ORIGIN).toBe("http://127.0.0.1:3100");
    expect(environment.AUTH_SESSION_SECRET).toBe("browser-pwa-session-secret-12345678901234567890");
    expect(environment.WEB_ORIGIN).toBe("http://127.0.0.1:3100");
    expect(environment.AUTH_TRUST_PROXY_HEADERS).toBe("false");
    expect(environment.NEXT_TELEMETRY_DISABLED).toBe("1");
  });
});
