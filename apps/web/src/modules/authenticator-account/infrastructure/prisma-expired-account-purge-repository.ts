import { prisma } from "@/shared/infrastructure/prisma-client";
import type { AccountPurgeBatch, ExpiredAccountPurgeRepository } from "../application/purge-expired-accounts";
import { ACCOUNT_RECOVERY_DAYS } from "../domain/account-retention-policy";

export class PrismaExpiredAccountPurgeRepository implements ExpiredAccountPurgeRepository {
  async purgeExpired(now: Date, batchSize: number): Promise<AccountPurgeBatch> {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      DELETE FROM "authenticator_accounts"
      WHERE "id" IN (
        SELECT "id"
        FROM "authenticator_accounts"
        WHERE "deleted_at" IS NOT NULL
          AND COALESCE("purge_after", "deleted_at" + (${ACCOUNT_RECOVERY_DAYS} * INTERVAL '1 day')) <= ${now}
        ORDER BY COALESCE("purge_after", "deleted_at" + (${ACCOUNT_RECOVERY_DAYS} * INTERVAL '1 day')), "id"
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
      )
      RETURNING "id"
    `;
    return { purgedIds: rows.map(({ id }) => id) };
  }
}
