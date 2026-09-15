import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaAccountDeletionRepository } from "@/modules/account-deletion/infrastructure/prisma-account-deletion-repository";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { prisma } from "@/shared/infrastructure/prisma-client";

const createdUserIds: string[] = [];
const deletionRecordIds: string[] = [];
const challengeIds: string[] = [];
const metricIds: string[] = [];

function bytes(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value.padEnd(16, "x"));
}

async function createUser(email = `${randomUUID()}@example.test`) {
  const user = await prisma.applicationUser.create({ data: { email } });
  createdUserIds.push(user.id);
  return user;
}

async function cleanup(): Promise<void> {
  if (challengeIds.length)
    await prisma.accountDeletionChallenge.deleteMany({ where: { id: { in: challengeIds.splice(0) } } });
  if (deletionRecordIds.length)
    await prisma.accountDeletionRecord.deleteMany({ where: { id: { in: deletionRecordIds.splice(0) } } });
  if (metricIds.length) await prisma.accountDeletionMetric.deleteMany({ where: { id: { in: metricIds.splice(0) } } });
  const userIds = createdUserIds.splice(0);
  if (!userIds.length) return;
  const vaults = await prisma.vault.findMany({
    where: { OR: [{ ownerId: { in: userIds } }, { members: { some: { userId: { in: userIds } } } }] },
    select: { id: true },
  });
  const vaultIds = vaults.map(({ id }) => id);
  await prisma.vaultAuditEvent.deleteMany({ where: { vaultId: { in: vaultIds } } });
  await prisma.authenticatorAccount.deleteMany({ where: { vaultId: { in: vaultIds } } });
  await prisma.vaultInvitation.deleteMany({
    where: { OR: [{ vaultId: { in: vaultIds } }, { recipientUserId: { in: userIds } }] },
  });
  await prisma.vaultMember.deleteMany({ where: { OR: [{ vaultId: { in: vaultIds } }, { userId: { in: userIds } }] } });
  await prisma.passkeyRecoveryChallenge.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.passkeyRecoveryCredential.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.userCryptoProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.applicationRateLimitWindow.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.identitySecurityEvent.deleteMany({ where: { applicationUserId: { in: userIds } } });
  await prisma.authSession.deleteMany({ where: { applicationUserId: { in: userIds } } });
  await prisma.vault.deleteMany({ where: { id: { in: vaultIds } } });
  await prisma.applicationUser.deleteMany({ where: { id: { in: userIds } } });
}

afterEach(cleanup);

describe("PrismaAccountDeletionRepository", () => {
  it.skipIf(!process.env.DATABASE_URL)(
    "hard-deletes owned data while preserving transferred Vault content",
    async () => {
      const deletingUser = await createUser("delete-me@example.test");
      const viewer = await createUser("new-owner@example.test");
      const otherOwner = await createUser("other-owner@example.test");
      const deletingIdentity = await prisma.externalIdentity.create({
        data: {
          applicationUserId: deletingUser.id,
          issuer: "rhasia:passwordless",
          subject: randomUUID(),
          email: deletingUser.email,
          emailVerifiedAt: new Date(),
          passwordlessIdentity: { create: { normalizedEmail: deletingUser.email } },
        },
      });
      await prisma.externalIdentity.create({
        data: {
          applicationUserId: deletingUser.id,
          issuer: "https://issuer.example.test",
          subject: randomUUID(),
          email: deletingUser.email,
          emailVerifiedAt: new Date(),
        },
      });

      const personalVault = await prisma.vault.create({
        data: {
          ownerId: deletingUser.id,
          type: "PERSONAL",
          lifecycle: "ACTIVE",
          encryptedName: bytes("personal-name"),
          encryptionVersion: 1,
          members: { create: { userId: deletingUser.id, role: "OWNER" } },
          accounts: { create: { encryptedPayload: bytes("personal-account"), encryptionVersion: 1 } },
        },
      });
      const transferredVault = await prisma.vault.create({
        data: {
          ownerId: deletingUser.id,
          type: "SHARED",
          lifecycle: "ACTIVE",
          encryptedName: bytes("transferred-name"),
          encryptionVersion: 1,
          members: {
            create: [
              { userId: deletingUser.id, role: "OWNER", encryptedVaultKey: bytes("owner-key"), keyVersion: 1 },
              { userId: viewer.id, role: "VIEWER", encryptedVaultKey: bytes("viewer-key"), keyVersion: 1 },
            ],
          },
          accounts: { create: { encryptedPayload: bytes("transferred-account"), encryptionVersion: 1 } },
        },
      });
      const deletedVault = await prisma.vault.create({
        data: {
          ownerId: deletingUser.id,
          type: "SHARED",
          lifecycle: "ACTIVE",
          encryptedName: bytes("deleted-name"),
          encryptionVersion: 1,
          members: {
            create: { userId: deletingUser.id, role: "OWNER", encryptedVaultKey: bytes("owner-key"), keyVersion: 1 },
          },
          accounts: { create: { encryptedPayload: bytes("deleted-account"), encryptionVersion: 1 } },
        },
      });
      const otherVault = await prisma.vault.create({
        data: {
          ownerId: otherOwner.id,
          type: "SHARED",
          lifecycle: "ACTIVE",
          encryptedName: bytes("other-name"),
          encryptionVersion: 1,
          members: {
            create: [
              { userId: otherOwner.id, role: "OWNER", encryptedVaultKey: bytes("other-owner-key"), keyVersion: 1 },
              { userId: deletingUser.id, role: "VIEWER", encryptedVaultKey: bytes("other-viewer-key"), keyVersion: 1 },
            ],
          },
          accounts: { create: { encryptedPayload: bytes("other-account"), encryptionVersion: 1 } },
        },
      });
      await prisma.vaultInvitation.createMany({
        data: [
          {
            vaultId: transferredVault.id,
            recipientEmail: "future-viewer@example.test",
            linkVerifier: randomBytes(16),
            encryptedPackage: bytes("preserved-invitation"),
          },
          {
            vaultId: deletedVault.id,
            recipientEmail: deletingUser.email,
            linkVerifier: randomBytes(16),
            encryptedPackage: bytes("deleted-invitation"),
          },
          {
            vaultId: otherVault.id,
            recipientUserId: deletingUser.id,
            linkVerifier: randomBytes(16),
            encryptedPackage: bytes("viewer-invitation"),
          },
        ],
      });
      await prisma.vaultAuditEvent.createMany({
        data: [
          { vaultId: transferredVault.id, ownerId: deletingUser.id, actorUserId: deletingUser.id, eventType: "TEST" },
          { vaultId: otherVault.id, ownerId: otherOwner.id, actorUserId: deletingUser.id, eventType: "TEST" },
          {
            vaultId: otherVault.id,
            ownerId: otherOwner.id,
            actorUserId: otherOwner.id,
            targetId: deletingUser.id,
            eventType: "TEST",
          },
        ],
      });
      await prisma.userCryptoProfile.create({
        data: {
          userId: deletingUser.id,
          vaultUnlockSalt: bytes("salt"),
          wrappedUserRootKey: bytes("root"),
          rootKeyWrappingVersion: 1,
          encryptedPersonalVaultKey: bytes("personal-key"),
          personalVaultKeyEncryptionVersion: 1,
        },
      });
      await prisma.passkeyRecoveryChallenge.create({
        data: {
          userId: deletingUser.id,
          purpose: "RECOVERY",
          challenge: randomUUID(),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      await prisma.applicationRateLimitWindow.create({
        data: {
          userId: deletingUser.id,
          operation: "account_mutation",
          windowStartedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          requestCount: 1,
        },
      });
      await prisma.identitySecurityEvent.create({ data: { applicationUserId: deletingUser.id, eventType: "TEST" } });

      const repository = new PrismaAccountDeletionRepository(bytes("deletion-secret"));
      const now = new Date(Date.now() + 1_000);
      const challenge = await repository.createPasswordlessOtpChallenge(deletingUser.id, now);
      challengeIds.push(challenge.challengeId);
      const authorization = await repository.verifyPasswordlessOtp(
        deletingUser.id,
        challenge.otp,
        new Date(now.getTime() + 1),
      );
      const result = await repository.deleteUser(
        deletingUser.id,
        authorization.authorizationToken,
        "passwordless",
        {
          confirmation: "HAPUS AKUN",
          acknowledged: true,
          vaultDecisions: [
            { vaultId: transferredVault.id, action: "TRANSFER", transferToUserId: viewer.id },
            { vaultId: deletedVault.id, action: "DELETE" },
          ],
        },
        new Date(now.getTime() + 2),
      );
      deletionRecordIds.push(result.receiptId);
      const record = await prisma.accountDeletionRecord.findUniqueOrThrow({
        where: { id: result.receiptId },
        include: { identities: true },
      });
      const metric = await prisma.accountDeletionMetric.findFirstOrThrow({
        where: { authBackend: "passwordless" },
        orderBy: { occurredAt: "desc" },
      });
      metricIds.push(metric.id);

      expect(result).toMatchObject({
        personalVaultCount: 1,
        sharedVaultDeletedCount: 1,
        sharedVaultTransferredCount: 1,
        authenticatorAccountCount: 2,
      });
      expect(record.identities).toHaveLength(2);
      expect(record.identities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ issuer: deletingIdentity.issuer, subject: deletingIdentity.subject }),
        ]),
      );
      await expect(prisma.applicationUser.findUnique({ where: { id: deletingUser.id } })).resolves.toBeNull();
      await expect(prisma.vault.findUnique({ where: { id: personalVault.id } })).resolves.toBeNull();
      await expect(prisma.vault.findUnique({ where: { id: deletedVault.id } })).resolves.toBeNull();
      await expect(prisma.authenticatorAccount.count({ where: { vaultId: transferredVault.id } })).resolves.toBe(1);
      await expect(
        prisma.vault.findUnique({ where: { id: transferredVault.id }, select: { ownerId: true } }),
      ).resolves.toEqual({ ownerId: viewer.id });
      await expect(
        prisma.vaultMember.findUnique({
          where: { vaultId_userId: { vaultId: transferredVault.id, userId: viewer.id } },
          select: { role: true },
        }),
      ).resolves.toEqual({ role: "OWNER" });
      await expect(prisma.vaultMember.count({ where: { userId: deletingUser.id } })).resolves.toBe(0);
      await expect(prisma.vaultInvitation.count({ where: { vaultId: transferredVault.id } })).resolves.toBe(1);
      await expect(
        prisma.vaultAuditEvent.count({
          where: {
            OR: [{ actorUserId: deletingUser.id }, { ownerId: deletingUser.id }, { targetId: deletingUser.id }],
          },
        }),
      ).resolves.toBe(0);
      await expect(repository.findCompletedDeletion(authorization.authorizationToken)).resolves.toMatchObject({
        receiptId: result.receiptId,
      });
    },
  );

  it.skipIf(!process.env.DATABASE_URL)(
    "rejects credentials issued before deletion but admits a fresh identity registration",
    async () => {
      const deletingUser = await createUser("resurrection@example.test");
      const subject = randomUUID();
      await prisma.externalIdentity.create({
        data: {
          applicationUserId: deletingUser.id,
          issuer: "oidc",
          subject,
          email: deletingUser.email,
          emailVerifiedAt: new Date(),
        },
      });
      const repository = new PrismaAccountDeletionRepository(bytes("deletion-secret-2"));
      const issuedAt = new Date(Date.now() - 10_000);
      const challenge = await repository.createOidcReauthenticationChallenge(deletingUser.id, new Date());
      challengeIds.push(challenge);
      const authorization = await repository.completeOidcReauthentication(challenge, "oidc", subject, new Date());
      const result = await repository.deleteUser(
        deletingUser.id,
        authorization.authorizationToken,
        "oidc",
        { confirmation: "HAPUS AKUN", acknowledged: true, vaultDecisions: [] },
        new Date(),
      );
      deletionRecordIds.push(result.receiptId);

      await expect(
        new PrismaApplicationUserRepository().provision({
          issuer: "oidc",
          subject,
          email: deletingUser.email,
          emailVerified: true,
          assurance: "active-session",
          issuedAt,
        }),
      ).rejects.toThrow("issued before account deletion");
      const fresh = await new PrismaApplicationUserRepository().provision({
        issuer: "oidc",
        subject,
        email: deletingUser.email,
        emailVerified: true,
        assurance: "active-session",
        issuedAt: new Date(Date.now() + 10_000),
      });
      createdUserIds.push(fresh.id);
      expect(fresh.id).not.toBe(deletingUser.id);
    },
  );
});
