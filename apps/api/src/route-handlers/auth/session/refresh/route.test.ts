import { describe, expect, it, vi } from "vitest";
import { attachApiRequestContext, type ApiRequestContext } from "@api/http/api-context";
import { ApiRequest } from "@api/http/api-request";
import { POST } from "@api/route-handlers/auth/session/refresh/route";

const session = {
  accessToken: "access-token",
  refreshToken: "refresh-token-rotated",
  accessExpiresAt: new Date("2026-09-14T00:15:00.000Z"),
  refreshExpiresAt: new Date("2026-10-14T00:00:00.000Z"),
  principal: { email: "person@example.test" },
};

function request(body: unknown, headers: Record<string, string> = {}) {
  const refresh = vi.fn().mockResolvedValue(session);
  const request = new ApiRequest("https://api.example.test/v1/auth/session/refresh", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  attachApiRequestContext(request, {
    database: {},
    bindings: {},
    identity: {
      sessionVerifier: {
        verify: async (request: Request) => (request.headers.has("cookie") ? { assurance: "active-session" } : null),
      },
      sessionTerminator: { terminateCurrentSession: async () => undefined },
      passwordlessAuth: {
        requestLink: async () => undefined,
        redeem: async () => null,
        verifyAccessToken: async () => null,
        verifyBrowserSession: async () => null,
        refresh,
        revoke: async () => undefined,
        publishPwaHandoff: async () => undefined,
        redeemPwaHandoff: async () => null,
      },
      applicationUsers: {
        provision: async () => {
          throw new Error("not used");
        },
      },
      userCryptoProfiles: {
        get: async () => null,
        registerUserEncryptionIdentity: async () => true,
        rewrapUserRootKey: async () => undefined,
      },
    },
    checkApplicationRateLimit: async () => ({ status: "allowed", retryAfterSeconds: 0 }),
  } as unknown as ApiRequestContext);
  return { request, refresh };
}

describe("POST /v1/auth/session/refresh credential selection", () => {
  it("renews the bounded assertion only for an active verified passwordless session", async () => {
    const request = new ApiRequest("https://api.example.test/v1/auth/session/refresh", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://api.example.test",
        cookie: "rhsia-passwordless-assertion=valid-assertion",
      },
      body: JSON.stringify({ client: "web" }),
    });
    attachApiRequestContext(request, {
      database: {},
      bindings: {
        AUTH_BACKEND: "passwordless",
        AUTH_APP_ORIGIN: "https://app.example.test",
        AUTH_MAGIC_LINK_SECRET: "synthetic-magic-link-secret-00000000",
        AUTH_SESSION_SECRET: "synthetic-session-secret-00000000000000",
      },
      identity: {
        sessionVerifier: {
          verify: async () => ({
            issuer: "rhasia:passwordless",
            sessionId: "synthetic-session-id-1234",
            sessionExpiresAt: new Date(Date.now() + 30 * 86_400_000),
            assurance: "active-session",
          }),
        },
      },
    } as unknown as ApiRequestContext);

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(response.cookies.getAll()).toHaveLength(1);
    expect(response.cookies.getAll()[0]).toContain("rhsia-passwordless-assertion=");
    expect(response.cookies.getAll()[0]).toContain("Max-Age=604800");
  });

  it("does not mint a passwordless assertion for a providerless browser session", async () => {
    const { request: e2eRequest } = request(
      { client: "web" },
      { origin: "https://api.example.test", cookie: "rhsia-e2e-session=synthetic-user" },
    );

    const response = await POST(e2eRequest);

    expect(response.status).toBe(200);
    expect(response.cookies.getAll()).toEqual([]);
  });

  it("accepts only same-origin web requests and never refreshes from a body token", async () => {
    const browser = request(
      { client: "web" },
      { origin: "https://api.example.test", cookie: "rhsia-passwordless-access=opaque" },
    );
    const response = await POST(browser.request);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ refreshed: true });
    expect(browser.refresh).not.toHaveBeenCalled();

    const retiredClient = await POST(
      request({ client: "mobile", refreshToken: "refresh-token" }, { origin: "https://api.example.test" }).request,
    );
    expect(retiredClient.status).toBe(400);

    const bodyToken = await POST(
      request({ client: "web", refreshToken: "refresh-token" }, { origin: "https://api.example.test" }).request,
    );
    expect(bodyToken.status).toBe(400);
  });

  it("rejects credentials in the wrong client channel", async () => {
    const bearer = request({ client: "web" }, { authorization: "Bearer access", origin: "https://api.example.test" });
    expect((await POST(bearer.request)).status).toBe(400);

    const missing = request({ client: "web" }, { origin: "https://api.example.test" });
    expect((await POST(missing.request)).status).toBe(401);
  });
});
