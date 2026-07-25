import { prisma } from "@/shared/infrastructure/prisma-client";

export class PrismaMembershipLifecycleRepository {
  public async revoke(ownerId: string, vaultId: string, memberUserId: string): Promise<void> {
    const vault = await prisma.vault.findFirst({ where: { id: vaultId, ownerId, type: "SHARED", lifecycle: "ACTIVE", deletedAt: null } });
    if (!vault || memberUserId === ownerId) throw new Error("Shared Vault owner access is required.");
    const updated = await prisma.vaultMember.updateMany({ where: { vaultId, userId: memberUserId, role: "VIEWER", status: "ACTIVE" }, data: { status: "REVOKED", revokedAt: new Date() } });
    if (updated.count !== 1) throw new Error("Active Viewer membership does not exist.");
  }

  public async leave(viewerId: string, vaultId: string): Promise<void> {
    const updated = await prisma.vaultMember.updateMany({ where: { vaultId, userId: viewerId, role: "VIEWER", status: "ACTIVE" }, data: { status: "LEFT", revokedAt: new Date() } });
    if (updated.count !== 1) throw new Error("Active Viewer membership does not exist.");
  }
}
