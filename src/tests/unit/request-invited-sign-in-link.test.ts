import { describe, expect, it, vi } from "vitest";
import { requestInvitedSignInLink } from "@/modules/identity/presentation/request-invited-sign-in-link";

describe("requestInvitedSignInLink", () => {
  it("uses passwordless sign-in without allowing public user creation", async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
    const sent = await requestInvitedSignInLink(
      { auth: { signInWithOtp } },
      "person@example.test",
      "https://vault.example.test/auth/confirm"
    );
    expect(sent).toBe(true);
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "person@example.test",
      options: { shouldCreateUser: false, emailRedirectTo: "https://vault.example.test/auth/confirm" }
    });
  });

  it("does not expose the provider error to the caller", async () => {
    const sent = await requestInvitedSignInLink(
      { auth: { signInWithOtp: vi.fn().mockResolvedValue({ error: new Error("not invited") }) } },
      "person@example.test",
      "https://vault.example.test/auth/confirm"
    );
    expect(sent).toBe(false);
  });
});
