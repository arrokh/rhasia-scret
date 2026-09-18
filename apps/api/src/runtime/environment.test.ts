import { describe, expect, it } from "vitest";
import { readApiBindings, readRuntimeDatabaseUrl, sanitizeApiRuntimeEnvironment } from "@api/runtime/environment";

describe("standalone API environment boundaries", () => {
  it("removes migration/admin and Web-only variables from local runtime scope", () => {
    const environment = sanitizeApiRuntimeEnvironment({
      DATABASE_URL: "postgresql://runtime.invalid/database",
      DIRECT_URL: "postgresql://direct.invalid/database",
      API_PROXY_SECRET: "web-only-secret",
      OIDC_CLIENT_SECRET: "callback-secret",
      POSTGRES_PASSWORD: "bootstrap-secret",
    });

    expect(environment).toEqual({ DATABASE_URL: "postgresql://runtime.invalid/database" });
  });

  it("keeps database URLs and web-only proxy aliases out of request bindings", () => {
    const bindings = readApiBindings({
      DATABASE_URL: "postgresql://runtime.invalid/database",
      DIRECT_URL: "postgresql://direct.invalid/database",
      API_PROXY_SECRET: "web-only-secret",
      PROXY_SECRET: "api-only-secret",
      WEB_ORIGIN: "https://web.example.test",
    });

    expect(bindings).toMatchObject({ PROXY_SECRET: "api-only-secret", WEB_ORIGIN: "https://web.example.test" });
    expect(bindings).not.toHaveProperty("DATABASE_URL");
    expect(bindings).not.toHaveProperty("DIRECT_URL");
    expect(bindings).not.toHaveProperty("API_PROXY_SECRET");
  });

  it("requires a runtime pooled database URL", () => {
    expect(() => readRuntimeDatabaseUrl({})).toThrow("DATABASE_URL is required");
    expect(readRuntimeDatabaseUrl({ DATABASE_URL: " postgresql://runtime.example.test/db " })).toBe(
      "postgresql://runtime.example.test/db",
    );
  });
});
