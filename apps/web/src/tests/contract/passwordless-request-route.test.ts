import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAnonymousAuthRateLimiter: vi.fn(),
  createPasswordlessAuthService: vi.fn(),
  createTurnstileValidator: vi.fn(),
  isPasswordlessClient: vi.fn((value: unknown) => value === "web" || value === "mobile" || value === "pwa"),
  isPasswordlessReturnPath: vi.fn((value: unknown) => value === "/vaults" || value === "/vaults/invitations/redeem"),
  isSafePwaHandoffId: vi.fn((value: string) => value === "pwa-handoff-123456"),
  isSafePwaHandoffVerifier: vi.fn((value: string) => value === "v".repeat(43)),
  isSafeTurnstileToken: vi.fn((value: string) => value.length > 0),
  isSameOrigin: vi.fn(() => true),
  requestClientIp: vi.fn(() => null),
}));

vi.mock("@/modules/identity/server", () => ({
  createAnonymousAuthRateLimiter: mocks.createAnonymousAuthRateLimiter,
  createPasswordlessAuthService: mocks.createPasswordlessAuthService,
  createTurnstileValidator: mocks.createTurnstileValidator,
  isPasswordlessClient: mocks.isPasswordlessClient,
  isPasswordlessReturnPath: mocks.isPasswordlessReturnPath,
  isSafePwaHandoffId: mocks.isSafePwaHandoffId,
  isSafePwaHandoffVerifier: mocks.isSafePwaHandoffVerifier,
  isSafeTurnstileToken: mocks.isSafeTurnstileToken,
  isSameOrigin: mocks.isSameOrigin,
  requestClientIp: mocks.requestClientIp,
}));

import { POST } from "@/app/api/auth/magic-link/request/route";

const requestUrl = "https://vault.example.test/api/auth/magic-link/request";

describe("passwordless request route contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createAnonymousAuthRateLimiter.mockReturnValue({
      check: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }),
    });
    mocks.createTurnstileValidator.mockReturnValue({ validate: vi.fn().mockResolvedValue("valid") });
    mocks.createPasswordlessAuthService.mockReturnValue({ requestLink: vi.fn().mockResolvedValue(undefined) });
    mocks.isSameOrigin.mockReturnValue(true);
  });

  it("forwards the opaque PWA handoff identifier without exposing account state", async () => {
    const service = mocks.createPasswordlessAuthService();
    const response = await POST(
      new NextRequest(requestUrl, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://vault.example.test" },
        body: JSON.stringify({
          email: "person@example.test",
          client: "pwa",
          returnPath: "/vaults",
          turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
          handoffId: "pwa-handoff-123456",
          handoffVerifier: "v".repeat(43),
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ sent: true });
    expect(service.requestLink).toHaveBeenCalledWith({
      email: "person@example.test",
      client: "pwa",
      returnPath: "/vaults",
      handoffId: "pwa-handoff-123456",
      handoffVerifier: "v".repeat(43),
    });
  });

  it("rejects a PWA request without its handoff identifier before rate limiting or delivery", async () => {
    const response = await POST(
      new NextRequest(requestUrl, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://vault.example.test" },
        body: JSON.stringify({
          email: "person@example.test",
          client: "pwa",
          returnPath: "/vaults",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.createAnonymousAuthRateLimiter).not.toHaveBeenCalled();
    expect(mocks.createPasswordlessAuthService).not.toHaveBeenCalled();
    expect(mocks.createTurnstileValidator).not.toHaveBeenCalled();
  });

  it("rejects a browser request without a Turnstile token before rate limiting", async () => {
    const response = await POST(
      new NextRequest(requestUrl, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://vault.example.test" },
        body: JSON.stringify({ email: "person@example.test", client: "web", returnPath: "/vaults" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_request" });
    expect(mocks.createTurnstileValidator).not.toHaveBeenCalled();
    expect(mocks.createAnonymousAuthRateLimiter).not.toHaveBeenCalled();
  });

  it("allows a native request without a browser Turnstile token", async () => {
    const service = mocks.createPasswordlessAuthService();
    const response = await POST(
      new NextRequest(requestUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "person@example.test", client: "mobile", returnPath: "/vaults" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ sent: true });
    expect(mocks.createTurnstileValidator).not.toHaveBeenCalled();
    expect(service.requestLink).toHaveBeenCalledWith({
      email: "person@example.test",
      client: "mobile",
      returnPath: "/vaults",
    });
  });

  it("rejects an invalid Turnstile token before consuming a rate-limit bucket", async () => {
    const validator = { validate: vi.fn().mockResolvedValue("invalid") };
    mocks.createTurnstileValidator.mockReturnValue(validator);
    const response = await POST(
      new NextRequest(requestUrl, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://vault.example.test" },
        body: JSON.stringify({
          email: "person@example.test",
          client: "web",
          returnPath: "/vaults",
          turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "turnstile_failed" });
    expect(validator.validate).toHaveBeenCalledWith("XXXX.DUMMY.TOKEN.XXXX");
    expect(mocks.createAnonymousAuthRateLimiter).not.toHaveBeenCalled();
  });

  it("fails closed when Turnstile is unavailable", async () => {
    mocks.createTurnstileValidator.mockReturnValue({ validate: vi.fn().mockResolvedValue("unavailable") });
    const response = await POST(
      new NextRequest(requestUrl, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://vault.example.test" },
        body: JSON.stringify({
          email: "person@example.test",
          client: "web",
          returnPath: "/vaults",
          turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
        }),
      }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("5");
    await expect(response.json()).resolves.toEqual({ error: "turnstile_unavailable" });
    expect(mocks.createAnonymousAuthRateLimiter).not.toHaveBeenCalled();
    expect(mocks.createPasswordlessAuthService).not.toHaveBeenCalled();
  });

  it("fails closed when the shared rate-limit backend is unavailable", async () => {
    mocks.createAnonymousAuthRateLimiter.mockReturnValue({
      check: vi.fn().mockRejectedValue(new Error("database down")),
    });
    const response = await POST(
      new NextRequest(requestUrl, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://vault.example.test" },
        body: JSON.stringify({
          email: "person@example.test",
          client: "web",
          returnPath: "/vaults",
          turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
        }),
      }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("5");
    await expect(response.json()).resolves.toEqual({ error: "rate_limit_unavailable" });
    expect(mocks.createPasswordlessAuthService).not.toHaveBeenCalled();
  });
});
