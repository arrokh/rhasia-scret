import { describe, expect, it, vi } from "vitest";
import { requestInvitedSignInLink } from "@/modules/identity/presentation/request-invited-sign-in-link";

describe("requestInvitedSignInLink", () => {
  it("uses passwordless sign-in without allowing public user creation", async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
    const result = await requestInvitedSignInLink(
      { auth: { signInWithOtp } },
      "person@example.test",
      "https://vault.example.test/auth/confirm"
    );
    expect(result).toBe("sent");
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "person@example.test",
      options: { shouldCreateUser: false, emailRedirectTo: "https://vault.example.test/auth/confirm" }
    });
  });

  it("does not expose provider errors", async () => {
    const result = await requestInvitedSignInLink(
      { auth: { signInWithOtp: vi.fn().mockResolvedValue({ error: new Error("not invited") }) } },
      "person@example.test",
      "https://vault.example.test/auth/confirm"
    );
    expect(result).toBe("error");
  });

  it("classifies provider rate limits without exposing provider details", async () => {
    const result = await requestInvitedSignInLink(
      { auth: { signInWithOtp: vi.fn().mockResolvedValue({ error: { status: 429, message: "rate limit" } }) } },
      "person@example.test",
      "https://vault.example.test/auth/confirm"
    );
    expect(result).toBe("rate_limited");
  });
});
