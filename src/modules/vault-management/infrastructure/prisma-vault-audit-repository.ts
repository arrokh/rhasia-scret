import { prisma } from "@/shared/infrastructure/prisma-client";

export type RedactedVaultAuditEvent = { id: string; eventType: string; createdAt: Date };

export class PrismaVaultAuditRepository {
  public async record(vaultId: string, actorUserId: string, eventType: string): Promise<void> {
    await prisma.vaultAuditEvent.create({ data: { vaultId, actorUserId, eventType } });
  }

  public async listForOwner(ownerId: string, vaultId: string): Promise<RedactedVaultAuditEvent[] | null> {
    const vault = await prisma.vault.findFirst({ where: { id: vaultId, ownerId, type: "SHARED" }, select: { auditEvents: { select: { id: true, eventType: true, createdAt: true }, orderBy: { createdAt: "desc" } } } });
    return vault?.auditEvents ?? null;
  }
}
