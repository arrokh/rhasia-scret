import { prisma } from "@/shared/infrastructure/prisma-client";
import { VAULT_RECOVERY_DAYS, auditPurgeAfter, vaultPurgeAfter } from "../domain/vault-retention-policy";

export class PrismaSharedVaultRecoveryRepository {
  constructor(private readonly now: () => Date = () => new Date()) {}

  public async delete(ownerId: string, vaultId: string): Promise<boolean> {
    const deletedAt = this.now();
    return prisma.$transaction(async (transaction) => {
      const result = await transaction.vault.updateMany({
        where: { id: vaultId, ownerId, type: "SHARED", lifecycle: "ACTIVE", deletedAt: null },
        data: { lifecycle: "DELETED", deletedAt, purgeAfter: vaultPurgeAfter(deletedAt) }
      });
      if (result.count !== 1) return false;
      const retentionPurgeAfter = auditPurgeAfter(deletedAt);
      await transaction.vaultAuditEvent.updateMany({ where: { vaultId }, data: { ownerId, retentionPurgeAfter } });
      await transaction.vaultAuditEvent.create({ data: { vaultId, ownerId, actorUserId: ownerId, eventType: "VAULT_DELETED", retentionPurgeAfter } });
      return true;
    });
  }

  public async restore(ownerId: string, vaultId: string): Promise<boolean> {
    const now = this.now();
    const legacyRecoveryCutoff = new Date(now.getTime() - VAULT_RECOVERY_DAYS * 24 * 60 * 60 * 1000);
    return prisma.$transaction(async (transaction) => {
      const result = await transaction.vault.updateMany({
        where: {
          id: vaultId,
          ownerId,
          type: "SHARED",
          lifecycle: "DELETED",
          deletedAt: { not: null },
          OR: [{ purgeAfter: { gt: now } }, { purgeAfter: null, deletedAt: { gt: legacyRecoveryCutoff } }]
        },
        data: { lifecycle: "ACTIVE", deletedAt: null, purgeAfter: null }
      });
      if (result.count !== 1) return false;
      await transaction.vaultAuditEvent.updateMany({ where: { vaultId }, data: { ownerId, retentionPurgeAfter: null } });
      await transaction.vaultAuditEvent.create({ data: { vaultId, ownerId, actorUserId: ownerId, eventType: "VAULT_RESTORED" } });
      return true;
    });
  }
}
