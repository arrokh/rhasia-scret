import { describe, expect, it } from "vitest";
import { decodeJwt } from "jose";
import { ResponseCookieStore } from "@api/http/cookies";
import {
  PASSWORDLESS_ASSERTION_TTL_SECONDS,
  renewPasswordlessBrowserAssertionCookie,
  setPasswordlessSessionCookies,
} from "@api/modules/identity/infrastructure/passwordless-session";

const configuration = {
  appOrigin: new URL("https://vault.example.test"),
  magicLinkSecret: new Uint8Array(32),
  sessionSecret: new Uint8Array(32),
  turnstile: { secretKey: "synthetic-turnstile-secret" },
  magicLinkTtlSeconds: 900,
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 2_592_000,
};

describe("bounded browser session assertions", () => {
  it("caps the assertion on the initial passwordless session cookies", async () => {
    const now = new Date("2026-11-05T00:00:00.000Z");
    const cookies = new ResponseCookieStore();

    await setPasswordlessSessionCookies(
      cookies,
      {
        sessionId: "synthetic-session-1234",
        accessToken: "synthetic-access-token",
        refreshToken: "synthetic-refresh-token",
        accessExpiresAt: new Date(now.getTime() + 15 * 60 * 1_000),
        refreshExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
        principal: {
          issuer: "rhasia:passwordless",
          subject: "synthetic-subject",
          email: "person@example.test",
          emailVerified: true,
          assurance: "active-session",
        },
      },
      configuration,
      now,
    );

    const assertionCookie = cookies.getAll().find((cookie) => cookie.startsWith("rhsia-passwordless-assertion=")) ?? "";
    const token = decodeURIComponent(assertionCookie.split(";", 1)[0]?.split("=", 2)[1] ?? "");
    const assertion = decodeJwt(token);
    expect(assertion.exp! - assertion.iat!).toBe(PASSWORDLESS_ASSERTION_TTL_SECONDS);
    expect(cookies.getAll().find((cookie) => cookie.startsWith("rhsia-passwordless-refresh="))).toContain(
      "Max-Age=2592000",
    );
  });

  it("renews a short-lived HttpOnly assertion without extending the database session", async () => {
    const now = new Date("2026-11-05T00:00:00.000Z");
    const sessionExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000);
    const cookies = new ResponseCookieStore();

    await renewPasswordlessBrowserAssertionCookie(
      cookies,
      configuration,
      "synthetic-session-1234",
      sessionExpiresAt,
      now,
    );

    const cookie = cookies.getAll()[0] ?? "";
    const token = decodeURIComponent(cookie.split(";", 1)[0]?.split("=", 2)[1] ?? "");
    const assertion = decodeJwt(token);
    expect(assertion.exp! - assertion.iat!).toBe(PASSWORDLESS_ASSERTION_TTL_SECONDS);
    expect(cookie).toContain("Max-Age=604800");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("does not extend an assertion past the verified session expiry", async () => {
    const now = new Date("2026-11-05T00:00:00.000Z");
    const sessionExpiresAt = new Date(now.getTime() + 300_000);
    const cookies = new ResponseCookieStore();
    await renewPasswordlessBrowserAssertionCookie(
      cookies,
      configuration,
      "synthetic-session-1234",
      sessionExpiresAt,
      now,
    );

    const token = decodeURIComponent(cookies.getAll()[0]?.split(";", 1)[0]?.split("=", 2)[1] ?? "");
    expect(decodeJwt(token).exp! - decodeJwt(token).iat!).toBe(300);
  });
});
