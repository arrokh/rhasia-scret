import { describe, expect, it, vi } from "vitest";
import { requestEmailSignInLink } from "@/modules/identity/presentation/request-email-sign-in-link";

describe("requestEmailSignInLink", () => {
  it("normalizes the email and sends a generic passwordless request", async () => {
    const requestMagicLink = vi.fn().mockResolvedValue({ error: null });
    const result = await requestEmailSignInLink({ requestMagicLink }, " Person@Example.Test ", "/vaults");
    expect(result).toBe("sent");
    expect(requestMagicLink).toHaveBeenCalledWith({ email: "person@example.test", returnPath: "/vaults" });
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
