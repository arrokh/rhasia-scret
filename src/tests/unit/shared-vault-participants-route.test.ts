import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listForOwner: vi.fn(), cancelInvitation: vi.fn() }));
vi.mock("@/modules/identity/application/load-application-user", () => ({ loadApplicationUser: async () => ({ id: "owner-1", canAccessApplication: () => true }) }));
vi.mock("@/modules/identity/infrastructure/prisma-application-user-repository", () => ({ PrismaApplicationUserRepository: class {} }));
vi.mock("@/modules/identity/infrastructure/supabase-session-verifier", () => ({ SupabaseSessionVerifier: class {} }));
vi.mock("@/modules/vault-membership/infrastructure/prisma-vault-participant-repository", () => ({ PrismaVaultParticipantRepository: class { listForOwner = mocks.listForOwner; cancelInvitation = mocks.cancelInvitation; } }));

import { GET } from "@/app/api/shared-vaults/[vaultId]/participants/route";
import { DELETE } from "@/app/api/shared-vaults/[vaultId]/share-links/[invitationId]/route";

describe("Shared Vault participant routes", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns owner-visible members and pending invitations", async () => {
    mocks.listForOwner.mockResolvedValue([{ key: "member:user-1", email: "viewer@example.test", kind: "MEMBER", userId: "user-1", invitationId: null, invitedAt: new Date("2026-07-26T12:00:00.000Z") }]);
    const response = await GET(new Request("http://localhost/api"), { params: Promise.resolve({ vaultId: "vault-1" }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ participants: [{ key: "member:user-1", email: "viewer@example.test", kind: "MEMBER", userId: "user-1", invitationId: null, invitedAt: "2026-07-26T12:00:00.000Z" }] });
  });

  it("deletes only an exact pending invitation owned by the caller", async () => {
    mocks.cancelInvitation.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await expect(DELETE(new Request("http://localhost/api", { method: "DELETE" }), { params: Promise.resolve({ vaultId: "vault-1", invitationId: "other" }) })).resolves.toMatchObject({ status: 404 });
    await expect(DELETE(new Request("http://localhost/api", { method: "DELETE" }), { params: Promise.resolve({ vaultId: "vault-1", invitationId: "invitation-1" }) })).resolves.toMatchObject({ status: 204 });
    expect(mocks.cancelInvitation).toHaveBeenLastCalledWith("owner-1", "vault-1", "invitation-1");
  });
});
