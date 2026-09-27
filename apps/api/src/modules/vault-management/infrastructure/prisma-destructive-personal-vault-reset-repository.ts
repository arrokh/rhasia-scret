import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";
import {
  ActiveOwnedSharedVaultsPreventResetError,
  PasskeyRecoveryAlreadyEnrolledError,
  type DestructivePersonalVaultResetEligibility,
  type DestructivePersonalVaultResetRepository,
} from "../application/destructive-personal-vault-reset";

export class PrismaDestructivePersonalVaultResetRepository implements DestructivePersonalVaultResetRepository {
  public constructor(private readonly database: PrismaDatabase) {}
  public async getEligibility(userId: string): Promise<DestructivePersonalVaultResetEligibility> {
    const [passkeyRecoveryCredential, activeOwnedSharedVaults] = await Promise.all([
      this.database.passkeyRecoveryCredential.findUnique({ where: { userId }, select: { userId: true } }),
      this.database.vault.findMany({
        where: { ownerId: userId, type: "SHARED", lifecycle: "ACTIVE", deletedAt: null },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    return {
      passkeyRecoveryEnrolled: Boolean(passkeyRecoveryCredential),
      activeOwnedSharedVaults: activeOwnedSharedVaults.length,
      activeOwnedSharedVaultIds: activeOwnedSharedVaults.map(({ id }) => id),
    };
  }

  public async reset(userId: string): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      const passkeyRecoveryCredential = await transaction.passkeyRecoveryCredential.findUnique({
        where: { userId },
        select: { userId: true },
      });
      if (passkeyRecoveryCredential) throw new PasskeyRecoveryAlreadyEnrolledError("Passkey recovery is available.");

      const activeOwnedSharedVaults = await transaction.vault.count({
        where: { ownerId: userId, type: "SHARED", lifecycle: "ACTIVE", deletedAt: null },
      });
      if (activeOwnedSharedVaults > 0) throw new ActiveOwnedSharedVaultsPreventResetError(activeOwnedSharedVaults);
      const activeSharedMemberships = await transaction.vaultMember.findMany({
        where: {
          userId,
          role: "VIEWER",
          status: "ACTIVE",
          vault: { type: "SHARED", lifecycle: "ACTIVE", deletedAt: null },
        },
        select: { vaultId: true },
      });
      for (const vaultId of [...new Set(activeSharedMemberships.map(({ vaultId }) => vaultId))].sort())
        await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "vaults" WHERE "id" = ${vaultId} FOR UPDATE
        `;

      const [personalVault, resettingUser] = await Promise.all([
        transaction.vault.findFirst({
          where: { ownerId: userId, type: "PERSONAL" },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        }),
        transaction.applicationUser.findUnique({ where: { id: userId }, select: { email: true } }),
      ]);
      if (!personalVault || !resettingUser) throw new Error("Personal Vault owner does not exist.");

      await transaction.authenticatorAccount.deleteMany({ where: { vaultId: personalVault.id } });
      await transaction.userCryptoProfile.deleteMany({ where: { userId } });
      await transaction.passkeyRecoveryChallenge.deleteMany({ where: { userId } });
      await transaction.vaultInvitation.deleteMany({
        where: {
          status: "PENDING",
          OR: [{ recipientUserId: userId }, { recipientEmail: { equals: resettingUser.email, mode: "insensitive" } }],
        },
      });
      await transaction.vaultMember.updateMany({
        where: { userId, role: "VIEWER", status: "ACTIVE", vault: { type: "SHARED" } },
        data: { status: "LEFT", encryptedVaultKey: null, keyVersion: null, revokedAt: new Date() },
      });
      await transaction.vault.update({
        where: { id: personalVault.id },
        data: {
          lifecycle: "UNINITIALIZED",
          encryptedName: null,
          encryptionVersion: 1,
          deletedAt: null,
          purgeAfter: null,
        },
      });
    });
  }
}
