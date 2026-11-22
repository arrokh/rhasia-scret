/** @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  postJson: vi.fn().mockResolvedValue({ sent: true, challengeExpiresInSeconds: 900 }),
  isPwaDisplayMode: vi.fn(() => false),
}));

vi.mock("@/shared/infrastructure/browser-api-client", () => ({
  BrowserApiError: class BrowserApiError extends Error {
    public constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
  browserApiClient: { postJson: mocks.postJson },
}));
vi.mock("@/modules/identity/infrastructure/pwa-authentication", () => ({
  isPwaDisplayMode: mocks.isPwaDisplayMode,
}));

import {
  browserPasswordlessClient,
  pollPwaAuthenticationHandoff,
} from "@/modules/identity/infrastructure/browser-passwordless-client";
import type { PendingPwaAuthenticationHandoff } from "@/modules/identity/infrastructure/pwa-authentication";

describe("browserPasswordlessClient", () => {
  it("returns the bounded challenge lifetime without changing the request secret boundary", async () => {
    mocks.postJson.mockResolvedValueOnce({ sent: true, challengeExpiresInSeconds: 3_600 });

    const result = await browserPasswordlessClient.requestMagicLink({
      email: "person@example.test",
      returnPath: "/vaults",
      client: "pwa",
      handoffId: "pwa-handoff-123456",
      handoffVerifier: "v".repeat(43),
    });

    expect(result).toEqual({ error: null, challengeExpiresInSeconds: 3_600 });
    expect(mocks.postJson).toHaveBeenCalledWith("/api/v1/auth/magic-link/request", {
      email: "person@example.test",
      client: "pwa",
      returnPath: "/vaults",
      handoffId: "pwa-handoff-123456",
      handoffVerifier: "v".repeat(43),
    });
  });

  it("rejects a response with malformed challenge lifetime metadata", async () => {
    mocks.postJson.mockResolvedValueOnce({ sent: true, challengeExpiresInSeconds: 3_601 });

    const result = await browserPasswordlessClient.requestMagicLink({
      email: "person@example.test",
      returnPath: "/vaults",
      client: "web",
    });

    expect(result.error).not.toBeNull();
  });

  it("sends only the verifier fields in a PWA handoff poll", async () => {
    mocks.postJson.mockResolvedValueOnce({ pending: true });
    const handoff: PendingPwaAuthenticationHandoff & { expiresAt: number } = {
      handoffId: "pwa-handoff-123456",
      verifier: "v".repeat(43),
      expiresAt: 1_800_000_000_000,
    };

    await pollPwaAuthenticationHandoff(handoff);

    expect(mocks.postJson).toHaveBeenCalledWith("/api/v1/auth/pwa/session", {
      handoffId: handoff.handoffId,
      verifier: handoff.verifier,
    });
  });

  it("sends the Turnstile token only in the transient sign-in request", async () => {
    await browserPasswordlessClient.requestMagicLink({
      email: "person@example.test",
      returnPath: "/vaults",
      turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
    });

    expect(mocks.postJson).toHaveBeenCalledWith("/api/v1/auth/magic-link/request", {
      email: "person@example.test",
      client: "web",
      returnPath: "/vaults",
      turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
    });
  });
});
