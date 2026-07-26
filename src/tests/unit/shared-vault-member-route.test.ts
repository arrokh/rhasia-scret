import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ revoke: vi.fn() }));
vi.mock("@/modules/identity/application/load-application-user", () => ({ loadApplicationUser: async () => ({ id: "owner-1", canAccessApplication: () => true }) }));
vi.mock("@/modules/identity/infrastructure/prisma-application-user-repository", () => ({ PrismaApplicationUserRepository: class {} }));
vi.mock("@/modules/identity/infrastructure/supabase-session-verifier", () => ({ SupabaseSessionVerifier: class {} }));
vi.mock("@/modules/vault-membership/infrastructure/prisma-membership-lifecycle-repository", () => ({ PrismaMembershipLifecycleRepository: class { revoke = mocks.revoke; } }));

import { DELETE } from "@/app/api/shared-vaults/[vaultId]/members/[userId]/route";
import { MembershipUnavailableError } from "@/modules/vault-membership/application/manage-membership-lifecycle";

describe("DELETE Shared Vault member", () => {
  afterEach(() => vi.clearAllMocks());

  it("revokes the exact member and only maps domain unavailability to 404", async () => {
    mocks.revoke.mockResolvedValueOnce(undefined);
    await expect(DELETE(new Request("http://localhost/api", { method: "DELETE" }), { params: Promise.resolve({ vaultId: "vault-1", userId: "viewer-1" }) })).resolves.toMatchObject({ status: 204 });
    expect(mocks.revoke).toHaveBeenCalledWith("owner-1", "vault-1", "viewer-1");

    mocks.revoke.mockRejectedValueOnce(new MembershipUnavailableError("unavailable"));
    await expect(DELETE(new Request("http://localhost/api", { method: "DELETE" }), { params: Promise.resolve({ vaultId: "vault-1", userId: "viewer-2" }) })).resolves.toMatchObject({ status: 404 });

    mocks.revoke.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(DELETE(new Request("http://localhost/api", { method: "DELETE" }), { params: Promise.resolve({ vaultId: "vault-1", userId: "viewer-3" }) })).rejects.toThrow("database unavailable");
  });
});
