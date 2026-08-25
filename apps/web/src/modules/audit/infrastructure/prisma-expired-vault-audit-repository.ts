import { prisma } from "@/shared/infrastructure/prisma-client";
import type { AuditPurgeBatch, ExpiredVaultAuditRepository } from "../application/purge-expired-vault-audit-events";

export class PrismaExpiredVaultAuditRepository implements ExpiredVaultAuditRepository {
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
