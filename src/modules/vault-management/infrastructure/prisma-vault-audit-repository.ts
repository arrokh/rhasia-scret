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

  public async listForOwner(ownerId: string, vaultId: string, filter: VaultAuditFilter = {}): Promise<RedactedVaultAuditEvent[] | null> {
    const now = this.now();
    const vault = await prisma.vault.findFirst({
      where: { id: vaultId, ownerId, type: "SHARED", lifecycle: { in: ["ACTIVE", "DELETED"] } },
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
        ...(vault?.lifecycle === "ACTIVE"
          ? { OR: [{ ownerId }, { ownerId: null }] }
          : vault?.lifecycle === "DELETED"
            ? { OR: [{ ownerId, retentionPurgeAfter: { gt: now } }, { ownerId: null, retentionPurgeAfter: null }] }
            : { ownerId, retentionPurgeAfter: { gt: now } }),
        ...(filter.accountId ? { targetId: filter.accountId } : {}),
        ...(filter.actorUserId ? { actorUserId: filter.actorUserId } : {})
      },
      select: { id: true, eventType: true, targetId: true, actorUserId: true, createdAt: true, actor: { select: { email: true } } },
      orderBy: { createdAt: "desc" }
    });
    return events.map((event) => ({ id: event.id, eventType: event.eventType, targetId: event.targetId, actorUserId: event.actorUserId, actorEmail: event.actor.email, createdAt: event.createdAt }));
  }
}
