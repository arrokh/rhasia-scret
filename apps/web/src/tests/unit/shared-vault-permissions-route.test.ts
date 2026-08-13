import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readVaultDefaults: vi.fn(), updateVaultDefaults: vi.fn(), updateMemberOverrides: vi.fn() }));
vi.mock("@/modules/identity/application/load-application-user", () => ({ loadApplicationUser: async () => ({ id: "owner-1", canAccessApplication: () => true }) }));
vi.mock("@/modules/identity/infrastructure/prisma-application-user-repository", () => ({ PrismaApplicationUserRepository: class {} }));
vi.mock("@/modules/identity/infrastructure/supabase-session-verifier", () => ({ SupabaseSessionVerifier: class {} }));
vi.mock("@/modules/vault-membership/infrastructure/prisma-shared-vault-account-permission-repository", () => ({
  PrismaSharedVaultAccountPermissionRepository: class {
    readVaultDefaults = mocks.readVaultDefaults;
    updateVaultDefaults = mocks.updateVaultDefaults;
    updateMemberOverrides = mocks.updateMemberOverrides;
  }
}));

import { GET as loadDefaults, PATCH as updateDefaults } from "@/app/api/shared-vaults/[vaultId]/member-permissions/route";
import { PATCH as updateMember } from "@/app/api/shared-vaults/[vaultId]/members/[userId]/route";

const permissions = { canAddAccounts: true, canEditAccounts: false, canDeleteAccounts: true };

describe("Shared Vault permission routes", () => {
  afterEach(() => vi.clearAllMocks());

  it("loads only the Vault-wide defaults needed by the Detail tab", async () => {
    mocks.readVaultDefaults.mockResolvedValue({ permissions, revision: 2 });
    const response = await loadDefaults(new Request("http://localhost/api"), { params: Promise.resolve({ vaultId: "vault-1" }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ vaultDefaultAccountPermissions: permissions, vaultDefaultAccountPermissionsRevision: 2 });
    expect(mocks.readVaultDefaults).toHaveBeenCalledWith("owner-1", "vault-1");
  });

  it("updates a complete Vault-wide default profile with revision protection", async () => {
    mocks.updateVaultDefaults.mockResolvedValue({ status: "UPDATED", value: { permissions, revision: 3 } });
    const response = await updateDefaults(request({ expectedRevision: 2, ...permissions }), { params: Promise.resolve({ vaultId: "vault-1" }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ vaultDefaultAccountPermissions: permissions, vaultDefaultAccountPermissionsRevision: 3 });
    expect(mocks.updateVaultDefaults).toHaveBeenCalledWith("owner-1", "vault-1", 2, permissions);
  });

  it("updates nullable member overrides independently", async () => {
    const overrides = { canAddAccounts: null, canEditAccounts: true, canDeleteAccounts: false };
    const effective = { permissions: { canAddAccounts: true, canEditAccounts: true, canDeleteAccounts: false }, sources: { canAddAccounts: "VAULT", canEditAccounts: "MEMBER", canDeleteAccounts: "MEMBER" } };
    mocks.updateMemberOverrides.mockResolvedValue({ status: "UPDATED", value: { overrides, effective, revision: 4 } });
    const response = await updateMember(request({ expectedRevision: 3, ...overrides }), { params: Promise.resolve({ vaultId: "vault-1", userId: "member-1" }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ permissionOverrides: overrides, effectiveAccountPermissions: effective, permissionsRevision: 4 });
    expect(mocks.updateMemberOverrides).toHaveBeenCalledWith("owner-1", "vault-1", "member-1", 3, overrides);
  });

  it("rejects partial or extra permission payloads", async () => {
    const partial = await updateMember(request({ expectedRevision: 1, canAddAccounts: null, canEditAccounts: true }), { params: Promise.resolve({ vaultId: "vault-1", userId: "member-1" }) });
    expect(partial.status).toBe(400);
    const extra = await updateDefaults(request({ expectedRevision: 1, ...permissions, role: "OWNER" }), { params: Promise.resolve({ vaultId: "vault-1" }) });
    expect(extra.status).toBe(400);
    expect(mocks.updateMemberOverrides).not.toHaveBeenCalled();
    expect(mocks.updateVaultDefaults).not.toHaveBeenCalled();
  });

  it("maps stale and unavailable updates without exposing Vault details", async () => {
    mocks.updateVaultDefaults.mockResolvedValueOnce({ status: "STALE" }).mockResolvedValueOnce({ status: "UNAVAILABLE" });
    const stale = await updateDefaults(request({ expectedRevision: 1, ...permissions }), { params: Promise.resolve({ vaultId: "vault-1" }) });
    expect(stale.status).toBe(409);
    const unavailable = await updateDefaults(request({ expectedRevision: 1, ...permissions }), { params: Promise.resolve({ vaultId: "vault-1" }) });
    expect(unavailable.status).toBe(404);
  });
});

function request(body: unknown) {
  return new Request("http://localhost/api", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
