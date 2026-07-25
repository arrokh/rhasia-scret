import { prisma } from "@/shared/infrastructure/prisma-client";

export class PrismaSharedVaultRecoveryRepository {
  public async delete(ownerId: string, vaultId: string): Promise<boolean> {
    const result = await prisma.vault.updateMany({ where: { id: vaultId, ownerId, type: "SHARED", lifecycle: "ACTIVE", deletedAt: null }, data: { lifecycle: "DELETED", deletedAt: new Date() } });
    return result.count === 1;
  }

  public async restore(ownerId: string, vaultId: string): Promise<boolean> {
    const result = await prisma.vault.updateMany({ where: { id: vaultId, ownerId, type: "SHARED", lifecycle: "DELETED", deletedAt: { gte: recoveryDeadline() } }, data: { lifecycle: "ACTIVE", deletedAt: null } });
    return result.count === 1;
  }
}

function recoveryDeadline(): Date {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
}
