import { describe, expect, it, vi } from "vitest";
import { ApplicationUser } from "@/modules/identity";
import { Vault } from "@/modules/vault-management/domain/vault";
import { resolveVaultPageContext, type ExistingVaultPageContext } from "@/modules/vault-management/application/vault-page-context";

const session = { issuer: "supabase", subject: "subject-1", email: "owner@example.test", emailVerified: true, assurance: "fresh-provider-user" as const };
const existing: ExistingVaultPageContext = {
  user: { id: "user-1", email: session.email, status: "ACTIVE" },
  personalVault: { id: "vault-1", lifecycle: "ACTIVE" }
};

function dependencies(context: ExistingVaultPageContext | null = existing) {
  return {
    sessions: { verify: vi.fn<() => Promise<typeof session | null>>(async () => session) },
    users: { provision: vi.fn(async () => new ApplicationUser("user-1", "supabase", session.subject, session.email, "ACTIVE")) },
    vaults: { ensureForOwner: vi.fn(async () => new Vault("vault-1", "PERSONAL", "user-1", "ACTIVE")) },
    contexts: { findByExternalIdentity: vi.fn(async () => context) }
  };
}

describe("Vault page context", () => {
  it("uses one read-only projection for an existing user and Personal Vault", async () => {
    const deps = dependencies();

    await expect(resolveVaultPageContext(deps.sessions, deps.users, deps.vaults, deps.contexts)).resolves.toEqual(existing);

    expect(deps.contexts.findByExternalIdentity).toHaveBeenCalledWith(session.issuer, session.subject);
    expect(deps.users.provision).not.toHaveBeenCalled();
    expect(deps.vaults.ensureForOwner).not.toHaveBeenCalled();
  });

  it("updates a changed verified email without recreating the Personal Vault", async () => {
    const deps = dependencies({ ...existing, user: { ...existing.user, email: "old@example.test" } });

    await expect(resolveVaultPageContext(deps.sessions, deps.users, deps.vaults, deps.contexts)).resolves.toEqual(existing);

    expect(deps.users.provision).toHaveBeenCalledWith(session);
    expect(deps.vaults.ensureForOwner).not.toHaveBeenCalled();
  });

  it("provisions missing first-login state and ensures one Personal Vault", async () => {
    const deps = dependencies(null);

    await expect(resolveVaultPageContext(deps.sessions, deps.users, deps.vaults, deps.contexts)).resolves.toEqual(existing);

    expect(deps.users.provision).toHaveBeenCalledWith(session);
    expect(deps.vaults.ensureForOwner).toHaveBeenCalledWith("user-1");
  });

  it("does not access the database without an authenticated session", async () => {
    const deps = dependencies();
    deps.sessions.verify.mockResolvedValue(null);

    await expect(resolveVaultPageContext(deps.sessions, deps.users, deps.vaults, deps.contexts)).resolves.toBeNull();
    expect(deps.contexts.findByExternalIdentity).not.toHaveBeenCalled();
  });
});
