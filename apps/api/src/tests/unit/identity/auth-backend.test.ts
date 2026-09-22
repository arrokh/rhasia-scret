import { describe, expect, it } from "vitest";
import { readAuthConfiguration } from "@api/modules/identity/infrastructure/auth-backend";

const requiredPasswordless = {
  AUTH_BACKEND: "passwordless",
  NODE_ENV: "test",
  AUTH_APP_ORIGIN: "http://localhost:3000",
  AUTH_MAGIC_LINK_SECRET: "12345678901234567890123456789012",
  AUTH_SESSION_SECRET: "abcdefghijklmnopqrstuvwxyz123456",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
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

describe("authentication backend configuration", () => {
  it("defaults to self-managed passwordless authentication", () => {
    expect(readAuthConfiguration(requiredPasswordless)).toMatchObject({ backend: "passwordless" });
  });

  it("reads passwordless origins, secrets, and bounded lifetimes", () => {
    expect(readAuthConfiguration(requiredPasswordless)).toMatchObject({
      backend: "passwordless",
      passwordless: {
        appOrigin: new URL("http://localhost:3000/"),
        mobileRedirectUrl: new URL("http://localhost:3000/auth/mobile"),
        magicLinkTtlSeconds: 900,
        accessTokenTtlSeconds: 900,
        refreshTokenTtlSeconds: 2_592_000,
        turnstile: {
          siteKey: "1x00000000000000000000AA",
          secretKey: "1x0000000000000000000000000000000AA",
        },
      },
    });
    expect(() => readAuthConfiguration({ ...requiredPasswordless, AUTH_MAGIC_LINK_SECRET: "short" })).toThrow(
      "AUTH_MAGIC_LINK_SECRET",
    );
    expect(() => readAuthConfiguration({ ...requiredPasswordless, NEXT_PUBLIC_TURNSTILE_SITE_KEY: undefined })).toThrow(
      "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
    );
    expect(() => readAuthConfiguration({ ...requiredPasswordless, TURNSTILE_SECRET_KEY: undefined })).toThrow(
      "TURNSTILE_SECRET_KEY",
    );
    expect(() =>
      readAuthConfiguration({
        ...requiredPasswordless,
        AUTH_SESSION_SECRET: requiredPasswordless.AUTH_MAGIC_LINK_SECRET,
      }),
    ).toThrow("different values");
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
    expect(() =>
      readAuthConfiguration({
        ...requiredPasswordless,
        AUTH_MOBILE_REDIRECT_URL: "rhasia-scret://auth:443/magic-link",
      }),
    ).toThrow("approved callback");
    expect(() =>
      readAuthConfiguration({
        ...requiredPasswordless,
        NODE_ENV: "production",
        AUTH_APP_ORIGIN: "https://host.test",
      }),
    ).toThrow("testing keys are not allowed");
  });

  it("supports local-only mode and the optional OIDC adapter", () => {
    expect(readAuthConfiguration({ AUTH_BACKEND: "none" })).toEqual({ backend: "none" });
    expect(readAuthConfiguration(requiredOidc).backend).toBe("oidc");
    expect(() => readAuthConfiguration({ ...requiredOidc, OIDC_SESSION_SECRET: "short" })).toThrow(
      "OIDC_SESSION_SECRET",
    );
    expect(() => readAuthConfiguration({ AUTH_BACKEND: "oidc", NODE_ENV: "test" })).toThrow("OIDC_ISSUER");
  });

  it("requires an explicit backend in production", () => {
    expect(() => readAuthConfiguration({ NODE_ENV: "production" })).toThrow("explicitly");
  });

  it("rejects invalid backend and insecure production redirects", () => {
    expect(() => readAuthConfiguration({ AUTH_BACKEND: "rhasia:passwordless" })).toThrow("AUTH_BACKEND");
    expect(() => readAuthConfiguration({ ...requiredOidc, NODE_ENV: "production" })).toThrow("OIDC_REDIRECT_URI");
  });
});
