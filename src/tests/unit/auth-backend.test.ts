import { afterEach, describe, expect, it, vi } from "vitest";
import { readAuthConfiguration } from "@/modules/identity/infrastructure/auth-backend";

const requiredOidc = {
  AUTH_BACKEND: "oidc",
  NODE_ENV: "test",
  OIDC_ISSUER: "https://issuer.example.test",
  OIDC_CLIENT_ID: "client-id",
  OIDC_CLIENT_SECRET: "server-secret",
  OIDC_REDIRECT_URI: "http://localhost:3000/auth/oidc/callback",
  OIDC_SESSION_SECRET: "12345678901234567890123456789012"
};

afterEach(() => vi.unstubAllEnvs());

describe("authentication backend configuration", () => {
  it("defaults to the existing Supabase adapter", () => {
    vi.stubEnv("AUTH_BACKEND", "supabase");
    expect(readAuthConfiguration()).toEqual({ backend: "supabase" });
  });

  it("supports local-only mode without provider configuration", () => {
    vi.stubEnv("AUTH_BACKEND", "none");
    expect(readAuthConfiguration()).toEqual({ backend: "none" });
  });

  it("requires all server-only OIDC settings and a strong session secret", () => {
    vi.stubEnv("AUTH_BACKEND", "oidc");
    expect(readAuthConfiguration({ ...requiredOidc, OIDC_REDIRECT_URI: "http://127.0.0.1:3000/auth/oidc/callback" }).backend).toBe("oidc");
    expect(() => readAuthConfiguration({ ...requiredOidc, OIDC_SESSION_SECRET: "short" })).toThrow("OIDC_SESSION_SECRET");
    expect(() => readAuthConfiguration({ AUTH_BACKEND: "oidc", NODE_ENV: "test" })).toThrow("OIDC_ISSUER");
  });

  it("rejects invalid backend and insecure production redirects", () => {
    expect(() => readAuthConfiguration({ AUTH_BACKEND: "unknown" })).toThrow("AUTH_BACKEND");
    expect(() => readAuthConfiguration({ ...requiredOidc, NODE_ENV: "production" })).toThrow("OIDC_REDIRECT_URI");
  });
});
