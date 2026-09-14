/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));

import type { PasswordlessAuthService } from "@/modules/identity/application/passwordless-authentication";
import type { PasswordlessConfiguration } from "@/modules/identity/infrastructure/auth-backend";
import {
  PASSWORDLESS_ACCESS_COOKIE,
  PASSWORDLESS_ASSERTION_COOKIE,
  PASSWORDLESS_REFRESH_COOKIE,
} from "@/modules/identity/infrastructure/passwordless-session";
import { PasswordlessSessionTerminator } from "@/modules/identity/infrastructure/passwordless-session-terminator";

const configuration: PasswordlessConfiguration = {
  appOrigin: new URL("http://localhost:3000"),
  mobileRedirectUrl: new URL("http://localhost:3000/auth/mobile"),
  magicLinkSecret: new Uint8Array(32),
  sessionSecret: new Uint8Array(32),
  magicLinkTtlSeconds: 900,
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 2_592_000,
};

function cookieStore(values: Partial<Record<string, string>>) {
  return {
    get: vi.fn((name: string) => {
      const value = values[name];
      return value === undefined ? undefined : { value };
    }),
    set: vi.fn(),
  };
}

describe("PasswordlessSessionTerminator", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not revoke a session from an unverified credential-shaped cookie", async () => {
    const store = cookieStore({
      [PASSWORDLESS_ACCESS_COOKIE]: `${"a".repeat(16)}.${"b".repeat(43)}`,
      [PASSWORDLESS_REFRESH_COOKIE]: `${"c".repeat(16)}.${"d".repeat(43)}`,
    });
    mocks.cookies.mockResolvedValue(store);
    const service = {
      verifyAccessToken: vi.fn().mockResolvedValue(null),
      verifyBrowserSession: vi.fn(),
      revoke: vi.fn().mockResolvedValue(undefined),
    } as unknown as PasswordlessAuthService;

    await new PasswordlessSessionTerminator(service, configuration).terminateCurrentSession();

    expect(service.verifyAccessToken).toHaveBeenCalledOnce();
    expect(service.revoke).not.toHaveBeenCalled();
    expect(store.set).toHaveBeenCalledWith(PASSWORDLESS_ACCESS_COOKIE, "", expect.anything());
    expect(store.set).toHaveBeenCalledWith(PASSWORDLESS_REFRESH_COOKIE, "", expect.anything());
    expect(store.set).toHaveBeenCalledWith(PASSWORDLESS_ASSERTION_COOKIE, "", expect.anything());
  });

  it("revokes only the session represented by a verified access credential", async () => {
    const store = cookieStore({ [PASSWORDLESS_ACCESS_COOKIE]: "opaque-access-token" });
    mocks.cookies.mockResolvedValue(store);
    const service = {
      verifyAccessToken: vi.fn().mockResolvedValue({ sessionId: "verified-session-id" }),
      verifyBrowserSession: vi.fn(),
      revoke: vi.fn().mockResolvedValue(undefined),
    } as unknown as PasswordlessAuthService;

    await new PasswordlessSessionTerminator(service, configuration).terminateCurrentSession();

    expect(service.verifyAccessToken).toHaveBeenCalledWith("opaque-access-token");
    expect(service.revoke).toHaveBeenCalledWith("verified-session-id");
  });
});
