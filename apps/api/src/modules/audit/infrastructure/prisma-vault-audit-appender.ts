import type { Prisma } from "@prisma/client";
import type { VaultAuditAppender } from "../application/vault-audit-appender";
import type { VaultAuditAppend } from "../domain/vault-audit-event";

export class PrismaTransactionalVaultAuditAppender implements VaultAuditAppender {
  constructor(private readonly transaction: Pick<Prisma.TransactionClient, "vaultAuditEvent">) {}

  async append(event: VaultAuditAppend): Promise<void> {
    await this.transaction.vaultAuditEvent.create({
      data: {
        vaultId: event.vaultId,
        ownerId: event.ownerId,
        actorUserId: event.actorUserId,
        eventType: event.action,
        ...(event.targetId ? { targetId: event.targetId } : {}),
        ...(event.retentionPurgeAfter ? { retentionPurgeAfter: event.retentionPurgeAfter } : {}),
      },
    });
  }
}

export function appendVaultAuditEvent(
  transaction: Pick<Prisma.TransactionClient, "vaultAuditEvent">,
  event: VaultAuditAppend,
): Promise<void> {
  return new PrismaTransactionalVaultAuditAppender(transaction).append(event);
}

export async function setVaultAuditRetention(
  transaction: Pick<Prisma.TransactionClient, "vaultAuditEvent">,
  vaultId: string,
  ownerId: string,
  retentionPurgeAfter: Date | null,
): Promise<void> {
  await transaction.vaultAuditEvent.updateMany({ where: { vaultId }, data: { ownerId, retentionPurgeAfter } });
}
