import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";
import {
  MembershipUnavailableError,
  type MembershipLifecycleRepository,
} from "../application/manage-membership-lifecycle";

export class PrismaMembershipLifecycleRepository implements MembershipLifecycleRepository {
  public constructor(private readonly database: PrismaDatabase) {}

  public async revoke(ownerId: string, vaultId: string, memberUserId: string): Promise<void> {
    if (memberUserId === ownerId) throw new MembershipUnavailableError("Shared Vault owner access is required.");
    await this.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${memberUserId}))`;
      const vault = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "vaults"
        WHERE "id" = ${vaultId}
          AND "owner_id" = ${ownerId}
          AND "type" = 'SHARED'
          AND "lifecycle" = 'ACTIVE'
          AND "deleted_at" IS NULL
        FOR UPDATE
      `;
      if (!vault[0]) throw new MembershipUnavailableError("Shared Vault owner access is required.");
      const updated = await tx.vaultMember.updateMany({
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
    });
  }

  public async leave(viewerId: string, vaultId: string): Promise<void> {
    await this.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${viewerId}))`;
      const vault = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "vaults"
        WHERE "id" = ${vaultId} AND "type" = 'SHARED' AND "lifecycle" = 'ACTIVE' AND "deleted_at" IS NULL
        FOR UPDATE
      `;
      if (!vault[0]) throw new MembershipUnavailableError("Active Viewer membership does not exist.");
      const updated = await tx.vaultMember.updateMany({
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
    });
  }
}
