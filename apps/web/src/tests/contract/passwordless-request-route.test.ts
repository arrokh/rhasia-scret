import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAnonymousAuthRateLimiter: vi.fn(),
  createPasswordlessAuthService: vi.fn(),
  isPasswordlessClient: vi.fn((value: unknown) => value === "web" || value === "mobile" || value === "pwa"),
  isPasswordlessReturnPath: vi.fn((value: unknown) => value === "/vaults" || value === "/vaults/invitations/redeem"),
  isSafePwaHandoffId: vi.fn((value: string) => value === "pwa-handoff-123456"),
  isSafePwaHandoffVerifier: vi.fn((value: string) => value === "v".repeat(43)),
  isSameOrigin: vi.fn(() => true),
  requestClientIp: vi.fn(() => null),
}));

vi.mock("@/modules/identity/server", () => ({
  createAnonymousAuthRateLimiter: mocks.createAnonymousAuthRateLimiter,
  createPasswordlessAuthService: mocks.createPasswordlessAuthService,
  isPasswordlessClient: mocks.isPasswordlessClient,
  isPasswordlessReturnPath: mocks.isPasswordlessReturnPath,
  isSafePwaHandoffId: mocks.isSafePwaHandoffId,
  isSafePwaHandoffVerifier: mocks.isSafePwaHandoffVerifier,
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
        body: JSON.stringify({ email: "person@example.test", client: "pwa", returnPath: "/vaults" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.createAnonymousAuthRateLimiter).not.toHaveBeenCalled();
    expect(mocks.createPasswordlessAuthService).not.toHaveBeenCalled();
  });
});
