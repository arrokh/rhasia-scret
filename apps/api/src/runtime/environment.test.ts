import { describe, expect, it } from "vitest";
import { readApiConfigBindings, readRuntimeDatabaseUrl, sanitizeApiRuntimeEnvironment } from "@api/runtime/environment";

describe("standalone API environment boundaries", () => {
  it("removes migration/admin and unsupported provider configuration from local runtime scope", () => {
    const environment = sanitizeApiRuntimeEnvironment({
      DATABASE_URL: "postgresql://runtime.invalid/database",
      DIRECT_URL: "postgresql://direct.invalid/database",
      API_PROXY_SECRET: "web-only-secret",
      AUTH_BACKEND: "oidc",
      OIDC_ISSUER: "https://issuer.example.test",
      OIDC_CLIENT_ID: "unsupported-client",
      OIDC_AUDIENCE: "unsupported-audience",
      OIDC_CLIENT_SECRET: "synthetic-unsupported-secret",
      OIDC_REDIRECT_URI: "https://app.example.test/auth/oidc/callback",
      OIDC_SESSION_SECRET: "synthetic-unsupported-session-secret",
      AUTH_ADMITTED_EMAILS: "person@example.test",
      POSTGRES_PASSWORD: "bootstrap-secret",
    });

    expect(environment).toEqual({
      DATABASE_URL: "postgresql://runtime.invalid/database",
      AUTH_BACKEND: "oidc",
    });
  });

  it("keeps database URLs and web-only proxy aliases out of request bindings", () => {
    const bindings = readApiConfigBindings({
      DATABASE_URL: "postgresql://runtime.invalid/database",
      DIRECT_URL: "postgresql://direct.invalid/database",
      API_PROXY_SECRET: "web-only-secret",
      PROXY_SECRET: "api-only-secret",
      WEB_ORIGIN: "https://web.example.test",
      OIDC_ISSUER: "https://issuer.example.test",
      OIDC_CLIENT_ID: "unsupported-client",
      AUTH_ADMITTED_EMAILS: "person@example.test",
    });

    expect(bindings).toMatchObject({ PROXY_SECRET: "api-only-secret", WEB_ORIGIN: "https://web.example.test" });
    expect(bindings).not.toHaveProperty("DATABASE_URL");
    expect(bindings).not.toHaveProperty("DIRECT_URL");
    expect(bindings).not.toHaveProperty("API_PROXY_SECRET");
    expect(bindings).not.toHaveProperty("OIDC_ISSUER");
    expect(bindings).not.toHaveProperty("OIDC_CLIENT_ID");
    expect(bindings).not.toHaveProperty("AUTH_ADMITTED_EMAILS");
  });

  it("requires a runtime pooled database URL", () => {
    expect(() => readRuntimeDatabaseUrl({})).toThrow("DATABASE_URL is required");
    expect(readRuntimeDatabaseUrl({ DATABASE_URL: " postgresql://runtime.example.test/db " })).toBe(
      "postgresql://runtime.example.test/db",
    );
  });
});
