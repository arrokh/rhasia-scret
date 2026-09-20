import { describe, expect, it } from "vitest";
import { readAuthConfiguration } from "@/modules/identity/infrastructure/auth-backend";

const requiredPasswordless = {
  AUTH_BACKEND: "passwordless",
  NODE_ENV: "test",
  AUTH_APP_ORIGIN: "http://localhost:3000",
};

const requiredOidc = {
  AUTH_BACKEND: "oidc",
  NODE_ENV: "test",
  OIDC_ISSUER: "https://issuer.example.test",
  OIDC_CLIENT_ID: "client-id",
  OIDC_CLIENT_SECRET: "server-secret",
  OIDC_REDIRECT_URI: "http://localhost:3000/auth/oidc/callback",
  OIDC_SESSION_SECRET: "12345678901234567890123456789012",
};

describe("web authentication configuration", () => {
  it("reads only web-owned passwordless origin settings", () => {
    expect(readAuthConfiguration(requiredPasswordless)).toEqual({
      backend: "passwordless",
      passwordless: {
        appOrigin: new URL("http://localhost:3000/"),
        mobileRedirectUrl: new URL("http://localhost:3000/auth/mobile"),
      },
    });
    expect(() => readAuthConfiguration({ ...requiredPasswordless, AUTH_APP_ORIGIN: "https://host.test/path" })).toThrow(
      "origin",
    );
    expect(
      readAuthConfiguration({ ...requiredPasswordless, AUTH_MOBILE_REDIRECT_URL: "rhasia-scret://auth/magic-link" }),
    ).toMatchObject({ passwordless: { mobileRedirectUrl: new URL("rhasia-scret://auth/magic-link") } });
    expect(() =>
      readAuthConfiguration({
        ...requiredPasswordless,
        NODE_ENV: "production",
        AUTH_APP_ORIGIN: "https://host.test",
        AUTH_MOBILE_REDIRECT_URL: "rhasia-scret://auth/magic-link",
      }),
    ).toThrow("approved callback");
  });

  it("supports local-only mode and the web-owned OIDC callback configuration", () => {
    expect(readAuthConfiguration({ AUTH_BACKEND: "none" })).toEqual({ backend: "none" });
    expect(readAuthConfiguration(requiredOidc).backend).toBe("oidc");
    expect(() => readAuthConfiguration({ ...requiredOidc, OIDC_SESSION_SECRET: "short" })).toThrow(
      "OIDC_SESSION_SECRET",
    );
    expect(() => readAuthConfiguration({ AUTH_BACKEND: "oidc", NODE_ENV: "test" })).toThrow("OIDC_ISSUER");
  });

  it("rejects invalid backend and insecure production redirects", () => {
    expect(() => readAuthConfiguration({ AUTH_BACKEND: "rhasia:passwordless" })).toThrow("AUTH_BACKEND");
    expect(() => readAuthConfiguration({ ...requiredOidc, NODE_ENV: "production" })).toThrow("OIDC_REDIRECT_URI");
  });
});
