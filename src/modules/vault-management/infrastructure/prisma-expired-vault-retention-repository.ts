import { prisma } from "@/shared/infrastructure/prisma-client";
import type { AuditPurgeBatch, ExpiredVaultRetentionRepository, VaultPurgeBatch } from "../application/purge-expired-vault-retention";
import { VAULT_RECOVERY_DAYS, auditPurgeAfter } from "../domain/vault-retention-policy";

type ExpiredVaultRow = { id: string; ownerId: string; deletedAt: Date };

export class PrismaExpiredVaultRetentionRepository implements ExpiredVaultRetentionRepository {
  async purgeExpiredVaults(now: Date, batchSize: number): Promise<VaultPurgeBatch> {
    return prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<ExpiredVaultRow[]>`
        SELECT "id", "owner_id" AS "ownerId", "deleted_at" AS "deletedAt"
        FROM "vaults"
        WHERE "type" = 'SHARED'
          AND "lifecycle" = 'DELETED'
          AND "deleted_at" IS NOT NULL
          AND COALESCE("purge_after", "deleted_at" + (${VAULT_RECOVERY_DAYS} * INTERVAL '1 day')) <= ${now}
        ORDER BY COALESCE("purge_after", "deleted_at" + (${VAULT_RECOVERY_DAYS} * INTERVAL '1 day')), "id"
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
      `;
      if (!rows.length) return { purgedIds: [] };

      for (const row of rows) {
        await transaction.vaultAuditEvent.updateMany({
          where: { vaultId: row.id },
          data: { ownerId: row.ownerId, retentionPurgeAfter: auditPurgeAfter(row.deletedAt) }
        });
      }
      const vaultIds = rows.map(({ id }) => id);
      await transaction.authenticatorAccount.deleteMany({ where: { vaultId: { in: vaultIds } } });
      await transaction.vaultInvitation.deleteMany({ where: { vaultId: { in: vaultIds } } });
      await transaction.vaultMember.deleteMany({ where: { vaultId: { in: vaultIds } } });
      const deleted = await transaction.vault.deleteMany({
        where: {
          id: { in: vaultIds },
          type: "SHARED",
          lifecycle: "DELETED",
          deletedAt: { not: null },
          OR: [{ purgeAfter: { lte: now } }, { purgeAfter: null, deletedAt: { lte: new Date(now.getTime() - VAULT_RECOVERY_DAYS * 24 * 60 * 60 * 1000) } }]
        }
      });
      if (deleted.count !== vaultIds.length) throw new Error("Expired Shared Vault purge lost its row lock invariant.");
      return { purgedIds: vaultIds };
    }, { isolationLevel: "ReadCommitted", maxWait: 5_000, timeout: 30_000 });
  }

  async purgeExpiredAuditEvents(now: Date, batchSize: number): Promise<AuditPurgeBatch> {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      DELETE FROM "vault_audit_events"
      WHERE "id" IN (
        SELECT "id"
        FROM "vault_audit_events"
        WHERE "retention_purge_after" IS NOT NULL
          AND "retention_purge_after" <= ${now}
        ORDER BY "retention_purge_after", "id"
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
      )
      RETURNING "id"
    `;
    return { purgedIds: rows.map(({ id }) => id) };
  }
}
