import { describe, expect, it } from "vitest";
import { readAuthConfiguration } from "@/modules/identity/infrastructure/auth-backend";

const requiredPasswordless = {
  AUTH_BACKEND: "passwordless",
  NODE_ENV: "test",
  AUTH_APP_ORIGIN: "http://localhost:3000",
};

describe("web authentication configuration", () => {
  it("allows localhost HTTP authentication in a production container", () => {
    expect(readAuthConfiguration({ ...requiredPasswordless, NODE_ENV: "production" })).toMatchObject({
      backend: "passwordless",
    });
    expect(() =>
      readAuthConfiguration({
        ...requiredPasswordless,
        NODE_ENV: "production",
        AUTH_APP_ORIGIN: "http://vault.example.test",
      }),
    ).toThrow("HTTPS");
  });

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
