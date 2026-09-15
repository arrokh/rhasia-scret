import { createHmac, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaPasswordlessAuthRepository } from "@/modules/identity/infrastructure/prisma-passwordless-auth-repository";
import { prisma } from "@/shared/infrastructure/prisma-client";

const applicationUserIds: string[] = [];
const deletionRecordIds: string[] = [];
const magicLinkDigests: Uint8Array<ArrayBuffer>[] = [];
const sessionSecret = new TextEncoder().encode("integration-passwordless-session-secret-1234567890");
const magicLinkSecret = new TextEncoder().encode("integration-passwordless-magic-link-secret-1234567890");
const configuration = {
  appOrigin: new URL("http://localhost:3000"),
  mobileRedirectUrl: new URL("http://localhost:3000/auth/mobile"),
  magicLinkSecret,
  sessionSecret,
  magicLinkTtlSeconds: 900,
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 2_592_000,
};

afterEach(async () => {
  if (magicLinkDigests.length > 0)
    await prisma.magicLinkChallenge.deleteMany({ where: { tokenDigest: { in: magicLinkDigests.splice(0) } } });
  if (deletionRecordIds.length > 0)
    await prisma.accountDeletionRecord.deleteMany({ where: { id: { in: deletionRecordIds.splice(0) } } });
  if (applicationUserIds.length > 0) {
    await prisma.applicationUser.deleteMany({ where: { id: { in: applicationUserIds.splice(0) } } });
  }
});

describe("PrismaPasswordlessAuthRepository", () => {
  it.skipIf(!process.env.DATABASE_URL)(
    "rejects a passwordless link created before deletion and admits a fresh link afterward",
    async () => {
      const repository = new PrismaPasswordlessAuthRepository(configuration);
      const email = `deletion-link-${randomUUID()}@example.test`;
      const account = await repository.findOrCreateAccount(email, new Date());
      applicationUserIds.push(account.applicationUserId);
      const oldDigest = digestWith(magicLinkSecret, `old-${randomUUID()}`);
      magicLinkDigests.push(databaseBytes(oldDigest));
      await repository.createChallenge({
        tokenDigest: oldDigest,
        challenge: { email, client: "web", returnPath: "/vaults" },
        expiresAt: new Date(Date.now() + 900_000),
      });
      const oldChallenge = await prisma.magicLinkChallenge.findUniqueOrThrow({
        where: { tokenDigest: Buffer.from(oldDigest) },
        select: { createdAt: true },
      });
      const deletedAt = new Date(oldChallenge.createdAt.getTime() + 1);
      const deletion = await prisma.accountDeletionRecord.create({
        data: {
          applicationUserId: account.applicationUserId,
          email,
          authBackend: "passwordless",
          requestedAt: deletedAt,
          completedAt: deletedAt,
          emailDeliveryStatus: "SENT",
          personalVaultCount: 0,
          sharedVaultDeletedCount: 0,
          sharedVaultTransferredCount: 0,
          authenticatorAccountCount: 0,
          identities: {
            create: {
              issuer: account.issuer,
              subject: account.subject,
              normalizedEmail: email,
              deletedAt,
            },
          },
        },
        select: { id: true },
      });
      deletionRecordIds.push(deletion.id);

      await expect(
        repository.consumeChallenge(oldDigest, "web", new Date(deletedAt.getTime() + 1)),
      ).resolves.toBeNull();
      await prisma.applicationUser.delete({ where: { id: account.applicationUserId } });
      applicationUserIds.splice(applicationUserIds.indexOf(account.applicationUserId), 1);

      const freshDigest = digestWith(magicLinkSecret, `fresh-${randomUUID()}`);
      magicLinkDigests.push(databaseBytes(freshDigest));
      await repository.createChallenge({
        tokenDigest: freshDigest,
        challenge: { email, client: "web", returnPath: "/vaults" },
        expiresAt: new Date(Date.now() + 900_000),
      });
      await prisma.magicLinkChallenge.update({
        where: { tokenDigest: Buffer.from(freshDigest) },
        data: { createdAt: new Date(deletedAt.getTime() + 10) },
      });
      await expect(
        repository.consumeChallenge(freshDigest, "web", new Date(deletedAt.getTime() + 11)),
      ).resolves.toEqual({
        email,
        client: "web",
        returnPath: "/vaults",
      });
      const freshAccount = await repository.findOrCreateAccount(email, new Date());
      applicationUserIds.push(freshAccount.applicationUserId);
      expect(freshAccount.applicationUserId).not.toBe(account.applicationUserId);
    },
  );

  it.skipIf(!process.env.DATABASE_URL)("rotates refresh credentials and revokes a replay", async () => {
    const repository = new PrismaPasswordlessAuthRepository(configuration);
    const account = await repository.findOrCreateAccount(`rotation-${randomUUID()}@example.test`, new Date());
    applicationUserIds.push(account.applicationUserId);
    const initial = await repository.createSession(account, new Date());
    const initialDigest = digest(initial.refreshToken);

    const rotated = await repository.rotateRefreshToken(initialDigest, initial.sessionId, new Date());
    const replay = await repository.rotateRefreshToken(initialDigest, initial.sessionId, new Date());
    const stored = await prisma.authSession.findUniqueOrThrow({ where: { id: initial.sessionId } });
    const securityEvent = await prisma.identitySecurityEvent.findFirst({
      where: { sessionId: initial.sessionId, eventType: "refresh_token_reuse_detected" },
    });

    expect(rotated?.refreshToken).not.toBe(initial.refreshToken);
    expect(replay).toBeNull();
    expect(stored.revokedAt).not.toBeNull();
    expect(stored.revocationReason).toBe("refresh_reuse_detected");
    expect(securityEvent).not.toBeNull();
  });

  it.skipIf(!process.env.DATABASE_URL)("publishes and atomically consumes a verifier-backed PWA handoff", async () => {
    const repository = new PrismaPasswordlessAuthRepository(configuration);
    const account = await repository.findOrCreateAccount(`pwa-${randomUUID()}@example.test`, new Date());
    applicationUserIds.push(account.applicationUserId);
    const initial = await repository.createSession(account, new Date());
    const handoffId = `pwa-${randomUUID().replaceAll("-", "")}`;
    const verifier = "v".repeat(43);
    const now = new Date("2026-09-14T00:00:00.000Z");
    await prisma.pwaAuthenticationHandoff.create({
      data: {
        handoffIdDigest: Buffer.from(digest(handoffId)),
        verifierDigest: Buffer.from(digest(verifier)),
        normalizedEmail: account.email,
        returnPath: "/vaults/invitations/redeem",
        expiresAt: new Date(now.getTime() + 900_000),
      },
    });

    await expect(
      repository.publishPwaHandoff(digest(initial.refreshToken), initial.sessionId, digest(handoffId), now),
    ).resolves.toBe(true);
    const wrongVerifier = await repository.redeemPwaHandoff(digest(handoffId), digest(`${"v".repeat(42)}w`), now);
    expect(wrongVerifier).toBeNull();
    const redeemed = await repository.redeemPwaHandoff(digest(handoffId), digest(verifier), now);
    const replay = await repository.redeemPwaHandoff(digest(handoffId), digest(verifier), now);

    expect(redeemed?.returnPath).toBe("/vaults/invitations/redeem");
    expect(redeemed?.session.refreshToken).not.toBe(initial.refreshToken);
    expect(replay).toBeNull();
    expect(
      await prisma.pwaAuthenticationHandoff.findUnique({
        where: { handoffIdDigest: Buffer.from(digest(handoffId)) },
        select: { publishedAt: true, consumedAt: true, sessionId: true },
      }),
    ).toEqual(
      expect.objectContaining({
        sessionId: initial.sessionId,
        publishedAt: expect.any(Date),
        consumedAt: expect.any(Date),
      }),
    );
  });

  it.skipIf(!process.env.DATABASE_URL)("does not bind one account to another account's PWA handoff", async () => {
    const repository = new PrismaPasswordlessAuthRepository(configuration);
    const victim = await repository.findOrCreateAccount(`victim-${randomUUID()}@example.test`, new Date());
    const attacker = await repository.findOrCreateAccount(`attacker-${randomUUID()}@example.test`, new Date());
    applicationUserIds.push(victim.applicationUserId, attacker.applicationUserId);
    const initial = await repository.createSession(attacker, new Date());
    const handoffId = `pwa-${randomUUID().replaceAll("-", "")}`;
    const now = new Date("2026-09-14T00:00:00.000Z");
    await prisma.pwaAuthenticationHandoff.create({
      data: {
        handoffIdDigest: Buffer.from(digest(handoffId)),
        verifierDigest: Buffer.from(digest("v".repeat(43))),
        normalizedEmail: victim.email,
        returnPath: "/vaults",
        expiresAt: new Date(now.getTime() + 900_000),
      },
    });

    const published = await repository.publishPwaHandoff(
      digest(initial.refreshToken),
      initial.sessionId,
      digest(handoffId),
      now,
    );

    expect(published).toBe(false);
    expect(
      await prisma.pwaAuthenticationHandoff.findUnique({
        where: { handoffIdDigest: Buffer.from(digest(handoffId)) },
        select: { sessionId: true, publishedAt: true },
      }),
    ).toEqual({ sessionId: null, publishedAt: null });
  });

  it.skipIf(!process.env.DATABASE_URL)("treats concurrent use of one refresh credential as reuse", async () => {
    const repository = new PrismaPasswordlessAuthRepository(configuration);
    const account = await repository.findOrCreateAccount(`concurrent-${randomUUID()}@example.test`, new Date());
    applicationUserIds.push(account.applicationUserId);
    const initial = await repository.createSession(account, new Date());

    const [first, second] = await Promise.all([
      repository.rotateRefreshToken(digest(initial.refreshToken), initial.sessionId, new Date()),
      repository.rotateRefreshToken(digest(initial.refreshToken), initial.sessionId, new Date()),
    ]);
    const stored = await prisma.authSession.findUniqueOrThrow({ where: { id: initial.sessionId } });

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(stored.revokedAt).not.toBeNull();
    expect(stored.revocationReason).toBe("refresh_reuse_detected");
  });
});

function digest(token: string): Uint8Array {
  return digestWith(sessionSecret, token);
}

function digestWith(secret: Uint8Array, value: string): Uint8Array {
  return new Uint8Array(createHmac("sha256", secret).update(value, "utf8").digest());
}

function databaseBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy;
}
