import { prisma } from "@/shared/infrastructure/prisma-client";
import type { RedactedVaultAuditEvent, VaultAuditFilter, VaultAuditRepository } from "../application/manage-vault-audit";

export class PrismaVaultAuditRepository implements VaultAuditRepository {
  public async record(vaultId: string, actorUserId: string, eventType: string): Promise<void> {
    await prisma.vaultAuditEvent.create({ data: { vaultId, actorUserId, eventType } });
  }

  public async recordAccountAccess(actorUserId: string, vaultId: string, accountId: string): Promise<boolean> {
    const membership = await prisma.vaultMember.findFirst({
      where: {
        vaultId,
        userId: actorUserId,
        status: "ACTIVE",
        role: { in: ["OWNER", "VIEWER"] },
        vault: { type: "SHARED", lifecycle: "ACTIVE", deletedAt: null, accounts: { some: { id: accountId, deletedAt: null } } }
      },
      select: { vaultId: true }
    });
    if (!membership) return false;
    await prisma.vaultAuditEvent.create({ data: { vaultId, actorUserId, eventType: "ACCOUNT_ACCESSED", targetId: accountId } });
    return true;
  }

  public async listForOwner(ownerId: string, vaultId: string, filter: VaultAuditFilter = {}): Promise<RedactedVaultAuditEvent[] | null> {
    const vault = await prisma.vault.findFirst({
      where: { id: vaultId, ownerId, type: "SHARED", lifecycle: "ACTIVE", deletedAt: null },
      select: {
        auditEvents: {
          where: {
            ...(filter.accountId ? { targetId: filter.accountId } : {}),
            ...(filter.actorUserId ? { actorUserId: filter.actorUserId } : {})
          },
          select: { id: true, eventType: true, targetId: true, actorUserId: true, createdAt: true, actor: { select: { email: true } } },
          orderBy: { createdAt: "desc" }
        }
      }
    });
    return vault?.auditEvents.map((event) => ({ id: event.id, eventType: event.eventType, targetId: event.targetId, actorUserId: event.actorUserId, actorEmail: event.actor.email, createdAt: event.createdAt })) ?? null;
  }
}
