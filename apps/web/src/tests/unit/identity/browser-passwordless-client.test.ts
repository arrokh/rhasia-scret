/** @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  postJson: vi.fn().mockResolvedValue({ sent: true }),
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

import { browserPasswordlessClient } from "@/modules/identity/infrastructure/browser-passwordless-client";

describe("browserPasswordlessClient", () => {
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
