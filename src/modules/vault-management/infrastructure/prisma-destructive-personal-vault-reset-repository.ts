import { prisma } from "@/shared/infrastructure/prisma-client";
import {
  ActiveOwnedSharedVaultsPreventResetError,
  PasskeyRecoveryAlreadyEnrolledError,
  type DestructivePersonalVaultResetEligibility,
  type DestructivePersonalVaultResetRepository
} from "../application/destructive-personal-vault-reset";

export class PrismaDestructivePersonalVaultResetRepository implements DestructivePersonalVaultResetRepository {
  public async getEligibility(userId: string): Promise<DestructivePersonalVaultResetEligibility> {
    const [passkeyRecoveryCredential, activeOwnedSharedVaults] = await Promise.all([
      prisma.passkeyRecoveryCredential.findUnique({ where: { userId }, select: { userId: true } }),
      prisma.vault.findMany({
        where: { ownerId: userId, type: "SHARED", lifecycle: "ACTIVE", deletedAt: null },
        select: { id: true },
        orderBy: { createdAt: "asc" }
      })
    ]);
    return {
      passkeyRecoveryEnrolled: Boolean(passkeyRecoveryCredential),
      activeOwnedSharedVaults: activeOwnedSharedVaults.length,
      activeOwnedSharedVaultIds: activeOwnedSharedVaults.map(({ id }) => id)
    };
  }

  public async reset(userId: string): Promise<void> {
    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      const passkeyRecoveryCredential = await transaction.passkeyRecoveryCredential.findUnique({
        where: { userId },
        select: { userId: true }
      });
      if (passkeyRecoveryCredential) throw new PasskeyRecoveryAlreadyEnrolledError("Passkey recovery is available.");

      const activeOwnedSharedVaults = await transaction.vault.count({
        where: { ownerId: userId, type: "SHARED", lifecycle: "ACTIVE", deletedAt: null }
      });
      if (activeOwnedSharedVaults > 0) throw new ActiveOwnedSharedVaultsPreventResetError(activeOwnedSharedVaults);

      const personalVault = await transaction.vault.findFirst({
        where: { ownerId: userId, type: "PERSONAL" },
        orderBy: { createdAt: "asc" },
        select: { id: true }
      });
      if (!personalVault) throw new Error("Personal Vault does not exist.");

      await transaction.authenticatorAccount.deleteMany({ where: { vaultId: personalVault.id } });
      await transaction.userCryptoProfile.deleteMany({ where: { userId } });
      await transaction.passkeyRecoveryChallenge.deleteMany({ where: { userId } });
      await transaction.vaultInvitation.deleteMany({ where: { recipientUserId: userId, status: "PENDING" } });
      await transaction.vaultMember.updateMany({
        where: { userId, role: "VIEWER", status: "ACTIVE", vault: { type: "SHARED" } },
        data: { status: "LEFT", encryptedVaultKey: null, keyVersion: null, revokedAt: new Date() }
      });
      await transaction.vault.update({
        where: { id: personalVault.id },
        data: {
          lifecycle: "UNINITIALIZED",
          encryptedName: null,
          encryptionVersion: 1,
          deletedAt: null,
          purgeAfter: null
        }
      });
    });
  }
}
