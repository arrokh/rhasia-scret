import { describe, expect, it, vi } from "vitest";
import { linkIdentity } from "@/modules/identity/application/identity-linking";

const existing = { issuer: "https://supabase.example.test/auth/v1", subject: "old", email: "person@example.test", emailVerified: true, assurance: "active-session" as const };
const proposed = { issuer: "https://issuer.example.test", subject: "new", email: "person@example.test", emailVerified: true, assurance: "active-session" as const };

describe("explicit identity linking", () => {
  it("requires fresh control of both identities and records through the repository", async () => {
    const link = vi.fn();
    await linkIdentity({ link }, { applicationUserId: "user-1", existing, proposed, existingReauthenticated: true, proposedReauthenticated: true });
    expect(link).toHaveBeenCalledOnce();
  });

  it.each([
    [{ existingReauthenticated: false, proposedReauthenticated: true }, "reauthentication"],
    [{ existingReauthenticated: true, proposedReauthenticated: false }, "reauthentication"],
    [{ existingReauthenticated: true, proposedReauthenticated: true, existing: { ...existing, assurance: "fresh-provider-user" as const } }, "active provider verification"],
    [{ existingReauthenticated: true, proposedReauthenticated: true, proposed: { ...proposed, assurance: "fresh-provider-user" as const } }, "active provider verification"]
  ])("rejects unsafe linking (%s)", async (override, message) => {
    const link = vi.fn();
    await expect(linkIdentity({ link }, { applicationUserId: "user-1", existing, proposed, ...override })).rejects.toThrow(message);
    expect(link).not.toHaveBeenCalled();
  });

  it("does not use equal verified email as an automatic link", async () => {
    const link = vi.fn();
    await linkIdentity({ link }, { applicationUserId: "user-1", existing, proposed, existingReauthenticated: true, proposedReauthenticated: true });
    expect(link).toHaveBeenCalledOnce();
  });
});
