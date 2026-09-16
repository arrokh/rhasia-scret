import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";
import {
  MembershipUnavailableError,
  type MembershipLifecycleRepository,
} from "../application/manage-membership-lifecycle";

export class PrismaMembershipLifecycleRepository implements MembershipLifecycleRepository {
  public constructor(private readonly database: PrismaDatabase) {}
  public async revoke(ownerId: string, vaultId: string, memberUserId: string): Promise<void> {
    const vault = await this.database.vault.findFirst({
      where: { id: vaultId, ownerId, type: "SHARED", lifecycle: "ACTIVE", deletedAt: null },
    });
    if (!vault || memberUserId === ownerId)
      throw new MembershipUnavailableError("Shared Vault owner access is required.");
    const updated = await this.database.vaultMember.updateMany({
      where: { vaultId, userId: memberUserId, role: "VIEWER", status: "ACTIVE" },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
        canAddAccountsOverride: null,
        canEditAccountsOverride: null,
        canDeleteAccountsOverride: null,
        permissionsRevision: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new MembershipUnavailableError("Active Viewer membership does not exist.");
  }

  public async leave(viewerId: string, vaultId: string): Promise<void> {
    const updated = await this.database.vaultMember.updateMany({
      where: { vaultId, userId: viewerId, role: "VIEWER", status: "ACTIVE" },
      data: {
        status: "LEFT",
        revokedAt: new Date(),
        canAddAccountsOverride: null,
        canEditAccountsOverride: null,
        canDeleteAccountsOverride: null,
        permissionsRevision: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new MembershipUnavailableError("Active Viewer membership does not exist.");
  }
}
