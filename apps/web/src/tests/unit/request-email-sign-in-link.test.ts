import { describe, expect, it, vi } from "vitest";
import { authConfirmationRedirectUrl, requestEmailSignInLink } from "@/modules/identity/presentation/request-email-sign-in-link";

describe("requestEmailSignInLink", () => {
  it("builds callback URLs from the active browser origin", () => {
    expect(authConfirmationRedirectUrl("http://localhost:3000")).toBe("http://localhost:3000/auth/confirm");
    expect(authConfirmationRedirectUrl("https://rhasia-scret.vercel.app")).toBe("https://rhasia-scret.vercel.app/auth/confirm");
  });

  it("uses passwordless sign-in and allows a new user to be created", async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
    const result = await requestEmailSignInLink(
      { auth: { signInWithOtp } },
      "person@example.test",
      "https://vault.example.test/auth/confirm"
    );
    expect(result).toBe("sent");
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "person@example.test",
      options: { shouldCreateUser: true, emailRedirectTo: "https://vault.example.test/auth/confirm" }
    });
  });

  it("does not expose provider errors", async () => {
    const result = await requestEmailSignInLink(
      { auth: { signInWithOtp: vi.fn().mockResolvedValue({ error: new Error("provider failure") }) } },
      "person@example.test",
      "https://vault.example.test/auth/confirm"
    );
    expect(result).toBe("error");
  });

  it("classifies provider rate limits without exposing provider details", async () => {
    const result = await requestEmailSignInLink(
      { auth: { signInWithOtp: vi.fn().mockResolvedValue({ error: { status: 429, message: "rate limit" } }) } },
      "person@example.test",
      "https://vault.example.test/auth/confirm"
    );
    expect(result).toBe("rate_limited");
  });
});
