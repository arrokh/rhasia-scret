import { describe, expect, it, vi } from "vitest";
import { PasswordlessSessionVerifier } from "@api/modules/identity/infrastructure/passwordless-session-verifier";
import type { PasswordlessAuthService } from "@api/modules/identity/application/passwordless-authentication";

const mocks = vi.hoisted(() => ({ verifyAssertion: vi.fn() }));

vi.mock("@api/modules/identity/infrastructure/passwordless-session", () => ({
  PASSWORDLESS_ACCESS_COOKIE: "rhsia-passwordless-access",
  PASSWORDLESS_ASSERTION_COOKIE: "rhsia-passwordless-assertion",
  verifyPasswordlessBrowserAssertion: mocks.verifyAssertion,
}));

const configuration = {
  appOrigin: new URL("https://vault.example.test"),
  mobileRedirectUrl: new URL("https://vault.example.test/auth/mobile"),
  magicLinkSecret: new Uint8Array(32),
  sessionSecret: new Uint8Array(32),
  turnstile: { siteKey: "site-key", secretKey: "secret-key" },
  magicLinkTtlSeconds: 900,
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 86_400,
};
const bearerPrincipal = {
  issuer: "rhasia:passwordless",
  subject: "subject-1",
  email: "person@example.test",
  emailVerified: true,
  assurance: "active-session" as const,
  sessionId: "session-1",
};
const cookiePrincipal = { ...bearerPrincipal };

function verifier(): PasswordlessSessionVerifier {
  const service: Partial<PasswordlessAuthService> = {
    verifyAccessToken: vi.fn().mockResolvedValue(bearerPrincipal),
    verifyBrowserSession: vi.fn(async (sessionId: string) => ({ ...cookiePrincipal, sessionId })),
  };
  return new PasswordlessSessionVerifier(service as PasswordlessAuthService, configuration);
}

describe("Passwordless session credential selection", () => {
  it("accepts a bearer and proxied cookie only when both resolve to the same session", async () => {
    mocks.verifyAssertion.mockResolvedValue("session-1");
    const result = await verifier().verify(
      new Request("https://api.example.test/v1/me", {
        headers: {
          authorization: "Bearer valid-token",
          cookie: "rhsia-passwordless-assertion=opaque-assertion",
          "x-rhasia-proxy-secret": "trusted",
        },
      }),
      "fresh-provider-user",
    );
    expect(result).toEqual(bearerPrincipal);
  });

  it("rejects conflicting or malformed credentials instead of falling back", async () => {
    mocks.verifyAssertion.mockResolvedValue("session-2");
    expect(
      await verifier().verify(
        new Request("https://api.example.test/v1/me", {
          headers: {
            authorization: "Bearer valid-token",
            cookie: "rhsia-passwordless-assertion=opaque-assertion",
            "x-rhasia-proxy-secret": "trusted",
          },
        }),
      ),
    ).toBeNull();

    expect(
      await verifier().verify(
        new Request("https://api.example.test/v1/me", {
          headers: { authorization: "invalid token", cookie: "rhsia-passwordless-access=opaque" },
        }),
      ),
    ).toBeNull();
  });

  it("rejects direct cookie credentials without the trusted proxy marker", async () => {
    mocks.verifyAssertion.mockResolvedValue("session-1");
    const result = await verifier().verify(
      new Request("https://api.example.test/v1/me", {
        headers: { cookie: "rhsia-passwordless-assertion=opaque-assertion" },
      }),
    );
    expect(result).toBeNull();
  });
});
