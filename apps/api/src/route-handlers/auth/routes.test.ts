import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiResponse } from "@api/http/api-request";
import type { ApiRequestContext } from "@api/http/api-context";
import { apiTestRequest } from "@api/tests/support/api-request";

const mocks = vi.hoisted(() => ({
  passwordlessAuth: { redeem: vi.fn(), redeemPwaHandoff: vi.fn(), publishPwaHandoff: vi.fn(), refresh: vi.fn() },
  sessionVerifier: { verify: vi.fn() },
  sessionTerminator: { terminateCurrentSession: vi.fn() },
}));

vi.mock("@api/modules/identity/server", () => ({
  AUTH_RETURN_PATH_COOKIE: "rhsia-return-path",
  isPasswordlessClient: (value: unknown) => value === "web" || value === "pwa" || value === "mobile",
  isClientOriginAllowed: (request: Request, client: "web" | "mobile" | "pwa") =>
    client === "mobile"
      ? !request.headers.has("origin") || request.headers.get("origin") === new URL(request.url).origin
      : request.headers.get("origin") === new URL(request.url).origin,
  isSameOriginIfPresent: (request: Request) =>
    !request.headers.has("origin") || request.headers.get("origin") === new URL(request.url).origin,
  isSafePwaHandoffId: (value: string) => value === "handoff",
  isSafePwaHandoffVerifier: (value: string) => value === "verifier",
  isSameOrigin: (request: Request) => request.headers.get("origin") === new URL(request.url).origin,
  readPasswordlessConfiguration: () => ({ accessCookieName: "rhsia-access", refreshCookieName: "rhsia-refresh" }),
  setPasswordlessSessionCookies: async (
    cookies: { set: (name: string, value: string, options: Record<string, unknown>) => void },
    session: { accessToken: string; refreshToken: string },
  ) => {
    cookies.set("rhsia-access", session.accessToken, { httpOnly: true });
    cookies.set("rhsia-refresh", session.refreshToken, { httpOnly: true });
  },
  clearPasswordlessSessionCookies: (cookies: {
    set: (name: string, value: string, options: Record<string, unknown>) => void;
  }) => {
    cookies.set("rhsia-access", "", { maxAge: 0 });
    cookies.set("rhsia-refresh", "", { maxAge: 0 });
  },
  clearE2eSessionCookie: (cookies: {
    set: (name: string, value: string, options: Record<string, unknown>) => void;
  }) => {
    cookies.set("rhsia-e2e-session", "", { maxAge: 0 });
  },
}));

import { POST as redeem } from "@api/route-handlers/auth/magic-link/redeem/route";
import { POST as pwaSession } from "@api/route-handlers/auth/pwa/session/route";
import { POST as refresh } from "@api/route-handlers/auth/session/refresh/route";
import { POST as revoke } from "@api/route-handlers/auth/session/revoke/route";

const session = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  accessExpiresAt: new Date("2026-09-16T00:10:00.000Z"),
  refreshExpiresAt: new Date("2026-09-17T00:00:00.000Z"),
  principal: { email: "person@example.test" },
};
const context = {
  identity: {
    passwordlessAuth: mocks.passwordlessAuth as unknown as ApiRequestContext["identity"]["passwordlessAuth"],
    sessionVerifier: mocks.sessionVerifier as unknown as ApiRequestContext["identity"]["sessionVerifier"],
    sessionTerminator: mocks.sessionTerminator as unknown as ApiRequestContext["identity"]["sessionTerminator"],
  },
} as unknown as Partial<ApiRequestContext>;
const request = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  apiTestRequest(
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    },
    context,
  );

beforeEach(() => {
  mocks.passwordlessAuth.redeem.mockResolvedValue({ session, returnPath: "/vaults" });
  mocks.passwordlessAuth.redeemPwaHandoff.mockResolvedValue(null);
  mocks.passwordlessAuth.publishPwaHandoff.mockResolvedValue(undefined);
  mocks.passwordlessAuth.refresh.mockResolvedValue(session);
  mocks.sessionVerifier.verify.mockResolvedValue({ id: "user-1" });
});

afterEach(() => vi.clearAllMocks());

describe("passwordless authentication route contracts", () => {
  it("returns native credentials without issuing browser cookies", async () => {
    const response = await redeem(request("/v1/auth/magic-link/redeem", { token: "token", client: "mobile" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      accessExpiresAt: "2026-09-16T00:10:00.000Z",
      refreshExpiresAt: "2026-09-17T00:00:00.000Z",
      email: "person@example.test",
      returnPath: "/vaults",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("sets cookies for web redemption and exposes only the safe continuation path", async () => {
    const response = await redeem(
      request("/v1/auth/magic-link/redeem", { token: "token", client: "web" }, { origin: "https://api.example.test" }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ returnPath: "/vaults" });
    expect(response.cookies.getAll().some((cookie) => cookie.startsWith("rhsia-access="))).toBe(true);
    expect(response.cookies.getAll().join("\n")).not.toContain("refreshToken");
  });

  it("publishes PWA handoffs and returns pending or accepted cookies without a refresh token", async () => {
    const published = await pwaSession(
      request(
        "/v1/auth/pwa/session",
        { handoffId: "handoff", refreshToken: "refresh-token" },
        { origin: "https://api.example.test" },
      ),
    );
    expect(published.status).toBe(200);
    await expect(published.json()).resolves.toEqual({ published: true });
    expect(mocks.passwordlessAuth.publishPwaHandoff).toHaveBeenCalledWith("refresh-token", "handoff");

    const pending = await pwaSession(
      request(
        "/v1/auth/pwa/session",
        { handoffId: "handoff", verifier: "verifier" },
        { origin: "https://api.example.test" },
      ),
    );
    expect(pending.status).toBe(202);
    mocks.passwordlessAuth.redeemPwaHandoff.mockResolvedValue({ session, returnPath: "/vaults" });
    const accepted = await pwaSession(
      request(
        "/v1/auth/pwa/session",
        { handoffId: "handoff", verifier: "verifier" },
        { origin: "https://api.example.test" },
      ),
    );
    expect(accepted.status).toBe(200);
    await expect(accepted.json()).resolves.toEqual({ accepted: true, returnPath: "/vaults" });

    const malformed = await pwaSession(
      request(
        "/v1/auth/pwa/session",
        { handoffId: "malformed", verifier: "verifier" },
        { origin: "https://api.example.test" },
      ),
    );
    expect(malformed.status).toBe(400);
    expect(mocks.passwordlessAuth.redeemPwaHandoff).toHaveBeenCalledTimes(2);
  });

  it("refreshes mobile sessions only from the body and keeps web refresh read-only", async () => {
    const mobile = await refresh(
      request("/v1/auth/session/refresh", { client: "mobile", refreshToken: "refresh-token" }),
    );
    expect(mobile.status).toBe(200);
    await expect(mobile.json()).resolves.toMatchObject({ accessToken: "access-token", refreshToken: "refresh-token" });
    expect(mocks.passwordlessAuth.refresh).toHaveBeenCalledWith("refresh-token");

    const web = await refresh(
      request(
        "/v1/auth/session/refresh",
        { client: "web" },
        { origin: "https://api.example.test", cookie: "rhsia-access=opaque" },
      ),
    );
    expect(web.status).toBe(200);
    await expect(web.json()).resolves.toEqual({ refreshed: true });
    expect(mocks.sessionVerifier.verify).toHaveBeenCalledWith(expect.anything(), "active-session");
  });

  it("rejects wrong-channel credentials and clears expired browser sessions", async () => {
    const wrongChannel = await refresh(
      request(
        "/v1/auth/session/refresh",
        { client: "mobile", refreshToken: "token" },
        { authorization: "Bearer token" },
      ),
    );
    expect(wrongChannel.status).toBe(400);
    expect(mocks.passwordlessAuth.refresh).not.toHaveBeenCalled();

    mocks.sessionVerifier.verify.mockResolvedValue(null);
    const expired = await refresh(
      request(
        "/v1/auth/session/refresh",
        { client: "web" },
        { origin: "https://api.example.test", cookie: "rhsia-access=opaque" },
      ),
    );
    expect(expired.status).toBe(401);
    expect(
      expired.cookies.getAll().some((cookie) => cookie.startsWith("rhsia-access=") && cookie.includes("Max-Age=0")),
    ).toBe(true);
  });

  it("makes logout idempotent but requires proxy trust for cookie credentials", async () => {
    const rejected = await revoke(
      apiTestRequest(
        "/v1/auth/session/revoke",
        { method: "POST", headers: { cookie: "rhsia-access=opaque" } },
        context,
      ),
    );
    expect(rejected.status).toBe(403);
    expect(mocks.sessionTerminator.terminateCurrentSession).not.toHaveBeenCalled();

    const response = await revoke(
      apiTestRequest(
        "/v1/auth/session/revoke",
        {
          method: "POST",
          headers: {
            cookie: "rhsia-access=opaque",
            "x-rhasia-proxy-secret": "trusted",
            origin: "https://api.example.test",
          },
        },
        context,
      ),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.sessionTerminator.terminateCurrentSession).toHaveBeenCalledOnce();

    const bearer = await revoke(
      apiTestRequest(
        "/v1/auth/session/revoke",
        {
          method: "POST",
          headers: { authorization: "Bearer access-token" },
        },
        context,
      ),
    );
    expect(bearer.status).toBe(204);
    const conflicting = await revoke(
      apiTestRequest(
        "/v1/auth/session/revoke",
        {
          method: "POST",
          headers: {
            authorization: "Bearer access-token",
            cookie: "rhsia-access=opaque",
            "x-rhasia-proxy-secret": "trusted",
          },
        },
        context,
      ),
    );
    expect(conflicting.status).toBe(400);
  });

  it("preserves authentication failures without touching passwordless state", async () => {
    mocks.sessionVerifier.verify.mockResolvedValue(null);
    const response = await refresh(
      request("/v1/auth/session/refresh", { client: "web" }, { origin: "https://api.example.test" }),
    );
    expect(response.status).toBe(401);
    expect(mocks.passwordlessAuth.refresh).not.toHaveBeenCalled();
    expect(response).toBeInstanceOf(ApiResponse);
  });
});
