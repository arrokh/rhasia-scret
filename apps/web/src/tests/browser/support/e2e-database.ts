import { prisma } from "../../../shared/infrastructure/prisma-client";

export async function cleanBrowserE2eUsers(emails?: string[]): Promise<void> {
  const users = await prisma.applicationUser.findMany({
    where: emails?.length ? { email: { in: emails } } : { email: { endsWith: "@browser-e2e.test" } },
    select: { id: true },
  });
  const userIds = users.map(({ id }) => id);
  if (!userIds.length) return;
  const ownedVaults = await prisma.vault.findMany({ where: { ownerId: { in: userIds } }, select: { id: true } });
  const vaultIds = ownedVaults.map(({ id }) => id);

  await prisma.$transaction(async (transaction) => {
    await transaction.vaultAuditEvent.deleteMany({
      where: {
        OR: [
          { actorUserId: { in: userIds } },
          { ownerId: { in: userIds } },
          ...(vaultIds.length ? [{ vaultId: { in: vaultIds } }] : []),
        ],
      },
    });
    if (vaultIds.length) {
      await transaction.authenticatorAccount.deleteMany({ where: { vaultId: { in: vaultIds } } });
      await transaction.vaultInvitation.deleteMany({ where: { vaultId: { in: vaultIds } } });
      await transaction.vaultMember.deleteMany({ where: { vaultId: { in: vaultIds } } });
      await transaction.vault.deleteMany({ where: { id: { in: vaultIds } } });
    }
    await transaction.vaultInvitation.deleteMany({ where: { recipientUserId: { in: userIds } } });
    await transaction.vaultMember.deleteMany({ where: { userId: { in: userIds } } });
    await transaction.passkeyRecoveryChallenge.deleteMany({ where: { userId: { in: userIds } } });
    await transaction.passkeyRecoveryCredential.deleteMany({ where: { userId: { in: userIds } } });
    await transaction.userCryptoProfile.deleteMany({ where: { userId: { in: userIds } } });
    await transaction.applicationRateLimitWindow.deleteMany({ where: { userId: { in: userIds } } });
    await transaction.applicationUser.deleteMany({ where: { id: { in: userIds } } });
  });
}

export async function disconnectBrowserE2eDatabase(): Promise<void> {
  await prisma.$disconnect();
}
