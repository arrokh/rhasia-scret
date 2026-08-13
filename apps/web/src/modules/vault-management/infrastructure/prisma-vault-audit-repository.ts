import { buildCursorPage, DEFAULT_CURSOR_PAGE_SIZE, type CursorPage, type CursorPageRequest } from "@/shared/application/cursor-page";
import { timestampKeysetWhere } from "@/shared/infrastructure/prisma-cursor-pagination";
import { prisma } from "@/shared/infrastructure/prisma-client";
import type { RedactedVaultAuditEvent, VaultAuditFilter, VaultAuditRepository } from "../application/manage-vault-audit";
import { auditPurgeAfter } from "../domain/vault-retention-policy";

export class PrismaVaultAuditRepository implements VaultAuditRepository {
  constructor(private readonly now: () => Date = () => new Date()) {}

  public async recordAccountAccess(actorUserId: string, vaultId: string, accountId: string): Promise<boolean> {
    const membership = await prisma.vaultMember.findFirst({
      where: {
        vaultId,
        userId: actorUserId,
        status: "ACTIVE",
        role: { in: ["OWNER", "VIEWER"] },
        vault: { type: "SHARED", lifecycle: "ACTIVE", deletedAt: null, accounts: { some: { id: accountId, deletedAt: null } } }
      },
      select: { vault: { select: { ownerId: true } } }
    });
    if (!membership) return false;
    await prisma.vaultAuditEvent.create({ data: { vaultId, ownerId: membership.vault.ownerId, actorUserId, eventType: "ACCOUNT_ACCESSED", targetId: accountId } });
    return true;
  }

  public async recordArchiveExport(ownerId: string, vaultId: string): Promise<boolean> {
    return prisma.$transaction(async (transaction) => {
      const vaults = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "vaults"
        WHERE "id" = ${vaultId}
          AND "owner_id" = ${ownerId}
          AND "lifecycle" = 'ACTIVE'
          AND "deleted_at" IS NULL
        FOR UPDATE
      `;
      if (!vaults[0]) return false;
      await transaction.vaultAuditEvent.create({ data: { vaultId, ownerId, actorUserId: ownerId, eventType: "ARCHIVE_EXPORTED" } });
      return true;
    });
  }

  public async recordPersonalAccountCopiesToLocal(ownerId: string, vaultId: string, accountIds: string[]): Promise<boolean> {
    if (!accountIds.length || new Set(accountIds).size !== accountIds.length) return false;
    return prisma.$transaction(async (transaction) => {
      const vaults = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "vaults"
        WHERE "id" = ${vaultId}
          AND "owner_id" = ${ownerId}
          AND "type" = 'PERSONAL'
          AND "lifecycle" = 'ACTIVE'
          AND "deleted_at" IS NULL
        FOR UPDATE
      `;
      if (!vaults[0]) return false;
      const accounts = await transaction.authenticatorAccount.findMany({
        where: { vaultId, id: { in: accountIds }, deletedAt: null },
        select: { id: true }
      });
      if (accounts.length !== accountIds.length) return false;
      await transaction.vaultAuditEvent.createMany({
        data: accountIds.map((accountId) => ({ vaultId, ownerId, actorUserId: ownerId, eventType: "ACCOUNT_COPIED_TO_LOCAL", targetId: accountId }))
      });
      return true;
    });
  }

  public async listForOwner(ownerId: string, vaultId: string, filter: VaultAuditFilter = {}, request: CursorPageRequest = { cursor: null, limit: DEFAULT_CURSOR_PAGE_SIZE }): Promise<CursorPage<RedactedVaultAuditEvent> | null> {
    const now = this.now();
    const vault = await prisma.vault.findFirst({
      where: { id: vaultId, ownerId, lifecycle: { in: ["ACTIVE", "DELETED"] } },
      select: { lifecycle: true, deletedAt: true }
    });
    const retainedAfterVaultPurge = vault ? false : await prisma.vaultAuditEvent.count({
      where: { vaultId, ownerId, retentionPurgeAfter: { gt: now } }
    }) > 0;
    if (!vault && !retainedAfterVaultPurge) return null;
    if (vault?.lifecycle === "DELETED" && (!vault.deletedAt || auditPurgeAfter(vault.deletedAt) <= now)) return null;

    const events = await prisma.vaultAuditEvent.findMany({
      where: {
        vaultId,
        ...(filter.accountId ? { targetId: filter.accountId } : {}),
        ...(filter.actorUserId ? { actorUserId: filter.actorUserId } : {}),
        AND: [
          vault?.lifecycle === "ACTIVE"
            ? { OR: [{ ownerId }, { ownerId: null }] }
            : vault?.lifecycle === "DELETED"
              ? { OR: [{ ownerId, retentionPurgeAfter: { gt: now } }, { ownerId: null, retentionPurgeAfter: null }] }
              : { ownerId, retentionPurgeAfter: { gt: now } },
          ...(request.cursor ? [timestampKeysetWhere(request.cursor, "id", "descending")] : [])
        ]
      },
      select: { id: true, eventType: true, targetId: true, actorUserId: true, createdAt: true, actor: { select: { email: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: request.limit + 1
    });
    const rows = events.map((event) => ({ id: event.id, eventType: event.eventType, targetId: event.targetId, actorUserId: event.actorUserId, actorEmail: event.actor.email, createdAt: event.createdAt }));
    return buildCursorPage(rows, request.limit, (event) => ({ createdAt: event.createdAt, key: event.id }));
  }
}
