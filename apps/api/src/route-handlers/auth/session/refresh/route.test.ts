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
      sessionVerifier: { verify: async () => ({ assurance: "active-session" }) },
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
  it("accepts a mobile refresh token only from the request body", async () => {
    const { request: valid, refresh } = request({ client: "mobile", refreshToken: "refresh-token" });
    const response = await POST(valid);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ refreshToken: session.refreshToken });
    expect(refresh).toHaveBeenCalledWith("refresh-token");

    const cookie = await POST(
      request({ client: "mobile", refreshToken: "refresh-token" }, { cookie: "refresh=unexpected" }).request,
    );
    expect(cookie.status).toBe(400);
  });

  it("rejects credentials in the wrong client channel", async () => {
    const browser = request(
      { client: "web", refreshToken: "unexpected" },
      {
        origin: "https://api.example.test",
        "x-rhasia-expected-origin": "https://api.example.test",
      },
    );
    expect((await POST(browser.request)).status).toBe(400);

    const bearer = request({ client: "mobile", refreshToken: "refresh-token" }, { authorization: "Bearer access" });
    expect((await POST(bearer.request)).status).toBe(400);

    const missing = request({ client: "mobile" });
    expect((await POST(missing.request)).status).toBe(401);
  });
});
