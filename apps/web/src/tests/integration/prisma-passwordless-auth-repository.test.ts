import { createHmac, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaPasswordlessAuthRepository } from "@/modules/identity/infrastructure/prisma-passwordless-auth-repository";
import { prisma } from "@/shared/infrastructure/prisma-client";

const applicationUserIds: string[] = [];
const sessionSecret = new TextEncoder().encode("integration-passwordless-session-secret-1234567890");
const configuration = {
  appOrigin: new URL("http://localhost:3000"),
  mobileRedirectUrl: new URL("http://localhost:3000/auth/mobile"),
  magicLinkSecret: new TextEncoder().encode("integration-passwordless-magic-link-secret-1234567890"),
  sessionSecret,
  magicLinkTtlSeconds: 900,
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 2_592_000,
};

afterEach(async () => {
  if (applicationUserIds.length > 0) {
    await prisma.applicationUser.deleteMany({ where: { id: { in: applicationUserIds.splice(0) } } });
  }
});

describe("PrismaPasswordlessAuthRepository", () => {
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
  return new Uint8Array(createHmac("sha256", sessionSecret).update(token, "utf8").digest());
}
