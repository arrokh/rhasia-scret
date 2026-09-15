import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearPasswordlessSessionCookies: vi.fn(),
  createPasswordlessAuthService: vi.fn(),
  createSessionVerifier: vi.fn(),
  cookies: vi.fn(),
  readPasswordlessConfiguration: vi.fn(),
  isPasswordlessClient: vi.fn((value: unknown) => value === "web" || value === "mobile" || value === "pwa"),
  isPasswordlessReturnPath: vi.fn((value: unknown) => value === "/vaults" || value === "/vaults/invitations/redeem"),
  isSafePwaHandoffId: vi.fn((value: string) => value === "pwa-handoff-123456"),
  isSafePwaHandoffVerifier: vi.fn((value: string) => value === "v".repeat(43)),
  isSameOrigin: vi.fn(() => true),
  setPasswordlessSessionCookies: vi.fn(),
  PASSWORDLESS_REFRESH_COOKIE: "rhsia-passwordless-refresh",
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/modules/identity/server", () => ({
  clearPasswordlessSessionCookies: mocks.clearPasswordlessSessionCookies,
  createPasswordlessAuthService: mocks.createPasswordlessAuthService,
  createSessionVerifier: mocks.createSessionVerifier,
  readPasswordlessConfiguration: mocks.readPasswordlessConfiguration,
  isPasswordlessClient: mocks.isPasswordlessClient,
  isPasswordlessReturnPath: mocks.isPasswordlessReturnPath,
  isSafePwaHandoffId: mocks.isSafePwaHandoffId,
  isSafePwaHandoffVerifier: mocks.isSafePwaHandoffVerifier,
  isSameOrigin: mocks.isSameOrigin,
  setPasswordlessSessionCookies: mocks.setPasswordlessSessionCookies,
  AUTH_RETURN_PATH_COOKIE: "rhsia-auth-return-path",
  PASSWORDLESS_REFRESH_COOKIE: mocks.PASSWORDLESS_REFRESH_COOKIE,
}));

import { POST as redeemMagicLink } from "@/app/api/auth/magic-link/redeem/route";
import { POST as acceptPwaSession } from "@/app/api/auth/pwa/session/route";
import { POST as refreshSession } from "@/app/api/auth/session/refresh/route";

const token = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK";
const session = {
  sessionId: "0123456789abcdef",
  accessToken: `0123456789abcdef.${token}`,
  refreshToken: `0123456789abcdef.${token}`,
  accessExpiresAt: new Date("2026-09-14T00:15:00.000Z"),
  refreshExpiresAt: new Date("2026-10-14T00:00:00.000Z"),
  principal: { email: "person@example.test" },
};

describe("passwordless authentication route contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isPasswordlessClient.mockImplementation(
      (value: unknown) => value === "web" || value === "mobile" || value === "pwa",
    );
    mocks.isPasswordlessReturnPath.mockImplementation(
      (value: unknown) => value === "/vaults" || value === "/vaults/invitations/redeem",
    );
    mocks.isSameOrigin.mockReturnValue(true);
    mocks.readPasswordlessConfiguration.mockReturnValue({});
    mocks.setPasswordlessSessionCookies.mockResolvedValue(undefined);
  });

  it("returns opaque session credentials to the native client", async () => {
    mocks.createPasswordlessAuthService.mockReturnValue({
      redeem: vi.fn().mockResolvedValue({ session, returnPath: "/vaults" }),
    });

    const response = await redeemMagicLink(
      new NextRequest("https://vault.example.test/api/auth/magic-link/redeem", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://vault.example.test" },
        body: JSON.stringify({ token, client: "mobile" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      accessExpiresAt: session.accessExpiresAt.toISOString(),
      refreshExpiresAt: session.refreshExpiresAt.toISOString(),
      email: session.principal.email,
      returnPath: "/vaults",
    });
    expect(mocks.setPasswordlessSessionCookies).not.toHaveBeenCalled();
  });

  it("sets browser cookies while returning only a bounded continuation path", async () => {
    mocks.createPasswordlessAuthService.mockReturnValue({
      redeem: vi.fn().mockResolvedValue({ session, returnPath: "/vaults/invitations/redeem" }),
    });

    const response = await redeemMagicLink(
      new NextRequest("https://vault.example.test/api/auth/magic-link/redeem", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://vault.example.test" },
        body: JSON.stringify({ token, client: "web" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ returnPath: "/vaults/invitations/redeem" });
    expect(mocks.setPasswordlessSessionCookies).toHaveBeenCalledWith(expect.anything(), session, expect.anything());
  });

  it("returns only a refresh credential to a PWA callback", async () => {
    mocks.createPasswordlessAuthService.mockReturnValue({
      redeem: vi.fn().mockResolvedValue({ session, returnPath: "/vaults" }),
    });

    const response = await redeemMagicLink(
      new NextRequest("https://vault.example.test/api/auth/magic-link/redeem", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://vault.example.test" },
        body: JSON.stringify({ token, client: "pwa" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ refreshToken: session.refreshToken, returnPath: "/vaults" });
    expect(mocks.setPasswordlessSessionCookies).not.toHaveBeenCalled();
  });

  it("publishes a PWA callback session without returning the rotated credential", async () => {
    const publishPwaHandoff = vi.fn().mockResolvedValue(undefined);
    mocks.createPasswordlessAuthService.mockReturnValue({ publishPwaHandoff });

    const response = await acceptPwaSession(
      new NextRequest("https://vault.example.test/api/auth/pwa/session", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://vault.example.test" },
        body: JSON.stringify({
          handoffId: "pwa-handoff-123456",
          refreshToken: session.refreshToken,
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ published: true });
    expect(publishPwaHandoff).toHaveBeenCalledWith(
      "0123456789abcdef.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK",
      "pwa-handoff-123456",
    );
    expect(mocks.setPasswordlessSessionCookies).not.toHaveBeenCalled();
  });

  it("redeems the transient PWA handoff and sets cookies only in the receiving app", async () => {
    mocks.createPasswordlessAuthService.mockReturnValue({
      redeemPwaHandoff: vi.fn().mockResolvedValue({ session, returnPath: "/vaults" }),
    });

    const response = await acceptPwaSession(
      new NextRequest("https://vault.example.test/api/auth/pwa/session", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://vault.example.test" },
        body: JSON.stringify({ handoffId: "pwa-handoff-123456", verifier: "v".repeat(43) }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accepted: true, returnPath: "/vaults" });
    expect(mocks.setPasswordlessSessionCookies).toHaveBeenCalledWith(response.cookies, session, expect.anything());
  });

  it("keeps browser refresh validation read-only so concurrent loads cannot rotate the same token", async () => {
    const verify = vi.fn().mockResolvedValue({ assurance: "active-session" });
    mocks.createSessionVerifier.mockReturnValue({ verify });
    mocks.cookies.mockResolvedValue({ get: vi.fn(), set: vi.fn() });

    const requests = [1, 2].map(
      () =>
        new NextRequest("https://vault.example.test/api/auth/session/refresh", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "https://vault.example.test" },
          body: JSON.stringify({ client: "web" }),
        }),
    );
    const responses = await Promise.all(requests.map((request) => refreshSession(request)));

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    await expect(responses[0]?.json()).resolves.toEqual({ refreshed: true });
    await expect(responses[1]?.json()).resolves.toEqual({ refreshed: true });
    expect(verify).toHaveBeenCalledTimes(2);
    expect(verify).toHaveBeenCalledWith("active-session");
    expect(mocks.createPasswordlessAuthService).not.toHaveBeenCalled();
  });

  it("clears browser cookies when the keepalive session is no longer active", async () => {
    const verify = vi.fn().mockResolvedValue(null);
    mocks.createSessionVerifier.mockReturnValue({ verify });
    mocks.cookies.mockResolvedValue({ get: vi.fn(), set: vi.fn() });

    const response = await refreshSession(
      new NextRequest("https://vault.example.test/api/auth/session/refresh", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://vault.example.test" },
        body: JSON.stringify({ client: "web" }),
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.clearPasswordlessSessionCookies).toHaveBeenCalledWith(response.cookies);
  });

  it("rejects malformed requests before authentication work", async () => {
    mocks.createPasswordlessAuthService.mockReturnValue({ redeem: vi.fn() });
    const response = await redeemMagicLink(
      new NextRequest("https://vault.example.test/api/auth/magic-link/redeem", {
        method: "POST",
        body: JSON.stringify({ token, client: "unknown" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.createPasswordlessAuthService).not.toHaveBeenCalled();
  });
});
