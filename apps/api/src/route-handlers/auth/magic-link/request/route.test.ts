import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequest } from "@api/http/api-request";
import { attachApiRequestContext, type ApiRequestContext } from "@api/http/api-context";

const mocks = vi.hoisted(() => ({
  createAnonymousAuthRateLimiter: vi.fn(),
  createTurnstileValidator: vi.fn(),
  isPasswordlessClient: vi.fn((value: unknown) => value === "web" || value === "mobile" || value === "pwa"),
  isPasswordlessReturnPath: vi.fn((value: unknown) => value === "/vaults"),
  isSafePwaHandoffId: vi.fn((value: string) => value === "pwa-handoff-123456"),
  isSafePwaHandoffVerifier: vi.fn((value: string) => value === "v".repeat(43)),
  isSafeTurnstileToken: vi.fn((value: string) => value.length > 0),
  isSameOrigin: vi.fn(() => true),
  requestClientIp: vi.fn(() => null),
}));

vi.mock("@api/modules/identity/server", () => ({
  createAnonymousAuthRateLimiter: mocks.createAnonymousAuthRateLimiter,
  createTurnstileValidator: mocks.createTurnstileValidator,
  isPasswordlessClient: mocks.isPasswordlessClient,
  isPasswordlessReturnPath: mocks.isPasswordlessReturnPath,
  isSafePwaHandoffId: mocks.isSafePwaHandoffId,
  isSafePwaHandoffVerifier: mocks.isSafePwaHandoffVerifier,
  isSafeTurnstileToken: mocks.isSafeTurnstileToken,
  isSameOrigin: mocks.isSameOrigin,
  requestClientIp: mocks.requestClientIp,
}));

import { POST } from "@api/route-handlers/auth/magic-link/request/route";

const origin = "https://vault.example.test";
const token = "XXXX.DUMMY.TOKEN.XXXX";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createAnonymousAuthRateLimiter.mockReturnValue({
    check: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }),
  });
  mocks.createTurnstileValidator.mockReturnValue({ validate: vi.fn().mockResolvedValue("valid") });
  mocks.isSameOrigin.mockReturnValue(true);
});

describe("POST /v1/auth/magic-link/request contract", () => {
  it("validates Turnstile before rate limiting and forwards only the opaque PWA handoff", async () => {
    const service = { requestLink: vi.fn().mockResolvedValue(undefined) };
    const request = makeRequest(
      {
        email: "person@example.test",
        client: "pwa",
        returnPath: "/vaults",
        turnstileToken: token,
        handoffId: "pwa-handoff-123456",
        handoffVerifier: "v".repeat(43),
      },
      service,
    );
    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ sent: true });
    expect(mocks.createTurnstileValidator).toHaveBeenCalledOnce();
    expect(mocks.createAnonymousAuthRateLimiter).toHaveBeenCalledOnce();
    expect(service.requestLink).toHaveBeenCalledWith({
      email: "person@example.test",
      client: "pwa",
      returnPath: "/vaults",
      handoffId: "pwa-handoff-123456",
      handoffVerifier: "v".repeat(43),
    });
  });

  it("rejects malformed PWA requests before Turnstile, rate limiting, or delivery", async () => {
    const service = { requestLink: vi.fn() };
    const response = await POST(
      makeRequest({ email: "person@example.test", client: "pwa", returnPath: "/vaults" }, service),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_request" });
    expect(mocks.createTurnstileValidator).not.toHaveBeenCalled();
    expect(mocks.createAnonymousAuthRateLimiter).not.toHaveBeenCalled();
    expect(service.requestLink).not.toHaveBeenCalled();
  });

  it("allows native requests without Turnstile while rejecting browser token failures before limiting", async () => {
    const nativeService = { requestLink: vi.fn().mockResolvedValue(undefined) };
    const native = await POST(
      makeRequest({ email: "person@example.test", client: "mobile", returnPath: "/vaults" }, nativeService),
    );
    expect(native.status).toBe(200);
    expect(mocks.createTurnstileValidator).not.toHaveBeenCalled();

    mocks.createTurnstileValidator.mockReturnValue({ validate: vi.fn().mockResolvedValue("invalid") });
    const browser = await POST(
      makeRequest(
        { email: "person@example.test", client: "web", returnPath: "/vaults", turnstileToken: token },
        { requestLink: vi.fn() },
      ),
    );
    expect(browser.status).toBe(403);
    await expect(browser.json()).resolves.toEqual({ error: "turnstile_failed" });
    expect(mocks.createAnonymousAuthRateLimiter).toHaveBeenCalledOnce();
  });

  it("returns bounded unavailable errors for Turnstile and rate-limit failures", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      mocks.createTurnstileValidator.mockReturnValue({
        validate: vi.fn().mockRejectedValue(new Error("Turnstile provider is unavailable")),
      });
      const unavailableTurnstile = await POST(
        makeRequest(
          { email: "person@example.test", client: "web", returnPath: "/vaults", turnstileToken: token },
          { requestLink: vi.fn() },
        ),
      );
      expect(unavailableTurnstile.status).toBe(503);
      expect(unavailableTurnstile.headers.get("retry-after")).toBe("5");
      expect(errorSpy).toHaveBeenCalledWith(
        JSON.stringify({
          event: "magic_link_request_turnstile_unavailable",
          requestId: "0123456789abcdef0123456789abcdef",
          errorType: "Error",
        }),
      );

      mocks.createTurnstileValidator.mockReturnValue({ validate: vi.fn().mockResolvedValue("valid") });
      mocks.createAnonymousAuthRateLimiter.mockReturnValue({
        check: vi.fn().mockRejectedValue(new Error("database password must not be logged")),
      });
      const unavailableLimiter = await POST(
        makeRequest(
          { email: "person@example.test", client: "web", returnPath: "/vaults", turnstileToken: token },
          { requestLink: vi.fn() },
        ),
      );
      expect(unavailableLimiter.status).toBe(503);
      expect(unavailableLimiter.headers.get("retry-after")).toBe("5");
      expect(errorSpy).toHaveBeenCalledWith(
        JSON.stringify({
          event: "magic_link_request_rate_limit_unavailable",
          requestId: "0123456789abcdef0123456789abcdef",
          errorType: "Error",
        }),
      );
      expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("database password must not be logged");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("logs delivery failures without logging request data or provider details", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const providerError = new Error("provider response contained a secret");
      const unavailableDelivery = await POST(
        makeRequest(
          { email: "person@example.test", client: "web", returnPath: "/vaults", turnstileToken: token },
          { requestLink: vi.fn().mockRejectedValue(providerError) },
        ),
      );
      expect(unavailableDelivery.status).toBe(503);
      expect(errorSpy).toHaveBeenCalledWith(
        JSON.stringify({
          event: "magic_link_request_delivery_failed",
          requestId: "0123456789abcdef0123456789abcdef",
          errorType: "Error",
        }),
      );
      expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("provider response contained a secret");
    } finally {
      errorSpy.mockRestore();
    }
  });
});

function makeRequest(body: unknown, passwordlessAuth: { requestLink: ReturnType<typeof vi.fn> }): ApiRequest {
  const request = new ApiRequest(`${origin}/api/v1/auth/magic-link/request`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, "x-request-id": "0123456789abcdef0123456789abcdef" },
    body: JSON.stringify(body),
  });
  attachApiRequestContext(request, {
    database: {},
    bindings: { WEB_ORIGIN: origin },
    sessionVerifier: { verify: async () => null },
    sessionTerminator: { terminate: async () => undefined },
    passwordlessAuth: {
      ...passwordlessAuth,
      redeem: async () => null,
      verifyAccessToken: async () => null,
      verifyBrowserSession: async () => null,
      refresh: async () => null,
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
      registerUserEncryptionIdentity: async () => undefined,
      rewrapUserRootKey: async () => undefined,
    },
    checkApplicationRateLimit: async () => ({ status: "allowed", retryAfterSeconds: 0 }),
  } as unknown as ApiRequestContext);
  return request;
}
