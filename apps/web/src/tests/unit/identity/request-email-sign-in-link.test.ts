import { describe, expect, it, vi } from "vitest";
import { requestEmailSignInLink } from "@/modules/identity/presentation/request-email-sign-in-link";

describe("requestEmailSignInLink", () => {
  it("normalizes the email and sends a generic passwordless request", async () => {
    const requestMagicLink = vi.fn().mockResolvedValue({ error: null });
    const result = await requestEmailSignInLink({ requestMagicLink }, " Person@Example.Test ", "/vaults");
    expect(result).toBe("sent");
    expect(requestMagicLink).toHaveBeenCalledWith({ email: "person@example.test", returnPath: "/vaults" });
  });

  it("passes the installed-PWA handoff without exposing the email", async () => {
    const requestMagicLink = vi.fn().mockResolvedValue({ error: null });
    const result = await requestEmailSignInLink({ requestMagicLink }, "person@example.test", "/vaults", {
      client: "pwa",
      handoffId: "pwa-handoff-123456",
      handoffVerifier: "v".repeat(43),
    });

    expect(result).toBe("sent");
    expect(requestMagicLink).toHaveBeenCalledWith({
      email: "person@example.test",
      returnPath: "/vaults",
      client: "pwa",
      handoffId: "pwa-handoff-123456",
      handoffVerifier: "v".repeat(43),
    });
  });

  it("passes the one-time Turnstile token without retaining it in the result", async () => {
    const requestMagicLink = vi.fn().mockResolvedValue({ error: null });
    const result = await requestEmailSignInLink({ requestMagicLink }, "person@example.test", "/vaults", {
      turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
    });

    expect(result).toBe("sent");
    expect(requestMagicLink).toHaveBeenCalledWith({
      email: "person@example.test",
      returnPath: "/vaults",
      turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
    });
  });

  it("does not expose delivery errors", async () => {
    const result = await requestEmailSignInLink(
      { requestMagicLink: vi.fn().mockResolvedValue({ error: new Error("delivery failure") }) },
      "person@example.test",
      "/vaults",
    );
    expect(result).toBe("error");
  });

  it("classifies anonymous rate limits", async () => {
    const result = await requestEmailSignInLink(
      { requestMagicLink: vi.fn().mockResolvedValue({ error: { status: 429 } }) },
      "person@example.test",
      "/vaults",
    );
    expect(result).toBe("rate_limited");
  });
});
