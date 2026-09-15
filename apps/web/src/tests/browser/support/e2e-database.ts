import { prisma } from "../../../shared/infrastructure/prisma-client";

export async function cleanBrowserE2eUsers(emails?: string[]): Promise<void> {
  const emailFilter = emails?.length ? { in: emails } : { endsWith: "@browser-e2e.test" };
  const users = await prisma.applicationUser.findMany({
    where: { email: emailFilter },
    select: { id: true },
  });
  const userIds = users.map(({ id }) => id);
  const deletionRecords = await prisma.accountDeletionRecord.findMany({
    where: { email: emailFilter },
    select: { id: true },
  });
  const deletionRecordIds = deletionRecords.map(({ id }) => id);
  if (!userIds.length && !deletionRecordIds.length) return;
  const ownedVaults = userIds.length
    ? await prisma.vault.findMany({ where: { ownerId: { in: userIds } }, select: { id: true } })
    : [];
  const vaultIds = ownedVaults.map(({ id }) => id);

  await prisma.$transaction(async (transaction) => {
    await transaction.accountDeletionChallenge.deleteMany({
      where: {
        OR: [
          ...(userIds.length ? [{ applicationUserId: { in: userIds } }] : []),
          ...(deletionRecordIds.length ? [{ completedDeletionId: { in: deletionRecordIds } }] : []),
        ],
      },
    });
    if (deletionRecordIds.length)
      await transaction.accountDeletionRecord.deleteMany({ where: { id: { in: deletionRecordIds } } });
    if (userIds.length || vaultIds.length)
      await transaction.vaultAuditEvent.deleteMany({
        where: {
          OR: [
            ...(userIds.length ? [{ actorUserId: { in: userIds } }] : []),
            ...(userIds.length ? [{ ownerId: { in: userIds } }] : []),
            ...(userIds.length ? [{ targetId: { in: userIds } }] : []),
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
    if (userIds.length) {
      await transaction.vaultInvitation.deleteMany({ where: { recipientUserId: { in: userIds } } });
      await transaction.vaultMember.deleteMany({ where: { userId: { in: userIds } } });
      await transaction.passkeyRecoveryChallenge.deleteMany({ where: { userId: { in: userIds } } });
    }
    if (userIds.length) {
      await transaction.passkeyRecoveryCredential.deleteMany({ where: { userId: { in: userIds } } });
      await transaction.userCryptoProfile.deleteMany({ where: { userId: { in: userIds } } });
      await transaction.applicationRateLimitWindow.deleteMany({ where: { userId: { in: userIds } } });
      await transaction.applicationUser.deleteMany({ where: { id: { in: userIds } } });
    }
  });
}

export async function disconnectBrowserE2eDatabase(): Promise<void> {
  await prisma.$disconnect();
}
