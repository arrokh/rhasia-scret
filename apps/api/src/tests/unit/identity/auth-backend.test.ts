import { describe, expect, it } from "vitest";
import { readAuthConfiguration } from "@api/modules/identity/infrastructure/auth-backend";

const requiredPasswordless = {
  AUTH_BACKEND: "passwordless",
  NODE_ENV: "test",
  AUTH_APP_ORIGIN: "http://localhost:4000",
  AUTH_MAGIC_LINK_SECRET: "12345678901234567890123456789012",
  AUTH_SESSION_SECRET: "abcdefghijklmnopqrstuvwxyz123456",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
};

describe("authentication backend configuration", () => {
  it("defaults to self-managed passwordless authentication", () => {
    expect(readAuthConfiguration(requiredPasswordless)).toMatchObject({ backend: "passwordless" });
    expect(
      readAuthConfiguration({
        ...requiredPasswordless,
        TURNSTILE_SECRET_KEY: "",
      }),
    ).toMatchObject({
      backend: "passwordless",
      passwordless: { turnstile: { secretKey: "" } },
    });
  });

  it("allows localhost HTTP authentication in a production container", () => {
    expect(
      readAuthConfiguration({
        ...requiredPasswordless,
        NODE_ENV: "production",
        TURNSTILE_SECRET_KEY: "production-secret-key",
      }),
    ).toMatchObject({
      backend: "passwordless",
      passwordless: {
        turnstile: {
          validationPolicy: {
            kind: "strict",
            expectedAction: "magic_link_request",
            expectedHostname: "localhost",
          },
        },
      },
    });
    expect(() =>
      readAuthConfiguration({
        ...requiredPasswordless,
        NODE_ENV: "production",
        AUTH_APP_ORIGIN: "http://vault.example.test",
        TURNSTILE_SECRET_KEY: "production-secret-key",
      }),
    ).toThrow("HTTPS");
  });

  it("allows Turnstile testing keys only for local HTTP self-hosting", () => {
    expect(
      readAuthConfiguration({
        ...requiredPasswordless,
        NODE_ENV: "production",
        WEB_ORIGIN: "http://localhost:4000",
        TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
      }),
    ).toMatchObject({
      backend: "passwordless",
      passwordless: { turnstile: { validationPolicy: { kind: "sandbox" } } },
    });
    expect(() =>
      readAuthConfiguration({
        ...requiredPasswordless,
        NODE_ENV: "production",
        WEB_ORIGIN: "http://localhost:4000",
        AUTH_APP_ORIGIN: "https://host.example.test",
        TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
      }),
    ).toThrow("testing keys are not allowed");
    expect(() =>
      readAuthConfiguration({
        ...requiredPasswordless,
        NODE_ENV: "production",
        AUTH_APP_ORIGIN: "https://host.example.test",
        TURNSTILE_SECRET_KEY: "2x0000000000000000000000000000000AA",
      }),
    ).toThrow("testing keys are not allowed");
  });

  it("reads passwordless origins, secrets, and bounded lifetimes", () => {
    expect(readAuthConfiguration(requiredPasswordless)).toMatchObject({
      backend: "passwordless",
      passwordless: {
        appOrigin: new URL("http://localhost:4000/"),
        magicLinkTtlSeconds: 900,
        accessTokenTtlSeconds: 900,
        refreshTokenTtlSeconds: 2_592_000,
        turnstile: {
          secretKey: "1x0000000000000000000000000000000AA",
          validationPolicy: { kind: "sandbox" },
        },
      },
    });
    expect(() => readAuthConfiguration({ ...requiredPasswordless, AUTH_MAGIC_LINK_SECRET: "short" })).toThrow(
      "AUTH_MAGIC_LINK_SECRET",
    );
    expect(
      readAuthConfiguration({
        ...requiredPasswordless,
        TURNSTILE_SECRET_KEY: "",
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: "synthetic-web-site-key",
      }),
    ).toMatchObject({ passwordless: { turnstile: { secretKey: "" } } });
    expect(() =>
      readAuthConfiguration({
        ...requiredPasswordless,
        AUTH_SESSION_SECRET: requiredPasswordless.AUTH_MAGIC_LINK_SECRET,
      }),
    ).toThrow("different values");
    expect(() => readAuthConfiguration({ ...requiredPasswordless, AUTH_APP_ORIGIN: "https://host.test/path" })).toThrow(
      "origin",
    );
    expect(() =>
      readAuthConfiguration({
        ...requiredPasswordless,
        NODE_ENV: "production",
        AUTH_APP_ORIGIN: "https://host.test",
      }),
    ).toThrow("testing keys are not allowed");
  });

  it("supports local-only mode and rejects OIDC as an unsupported backend", () => {
    expect(readAuthConfiguration({ AUTH_BACKEND: "none" })).toEqual({ backend: "none" });
    expect(() => readAuthConfiguration({ AUTH_BACKEND: "oidc", NODE_ENV: "test" })).toThrow("AUTH_BACKEND");
  });

  it("requires an explicit backend in production", () => {
    expect(() => readAuthConfiguration({ NODE_ENV: "production" })).toThrow("explicitly");
  });

  it("rejects invalid and unsupported backends", () => {
    expect(() => readAuthConfiguration({ AUTH_BACKEND: "rhasia:passwordless" })).toThrow("AUTH_BACKEND");
    expect(() => readAuthConfiguration({ AUTH_BACKEND: "oidc", NODE_ENV: "production" })).toThrow("AUTH_BACKEND");
  });
});
