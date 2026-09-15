import { Prisma } from "@prisma/client";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  PASSWORDLESS_ISSUER,
  normalizeEmail,
  passwordlessPrincipal,
  type MagicLinkChallenge,
  type PasswordlessAccount,
  type PasswordlessAuthRepository,
  type PasswordlessClient,
  type PasswordlessReturnPath,
  type PasswordlessSession,
} from "../application/passwordless-authentication";
import type { VerifiedPrincipal } from "../application/session-verifier";
import { prisma } from "@/shared/infrastructure/prisma-client";
import { createSessionCredential } from "./passwordless-crypto";
import type { PasswordlessConfiguration } from "./auth-backend";

export class PrismaPasswordlessAuthRepository implements PasswordlessAuthRepository {
  public constructor(private readonly configuration: PasswordlessConfiguration) {}

  public async createChallenge(input: {
    tokenDigest: Uint8Array;
    challenge: MagicLinkChallenge;
    expiresAt: Date;
    pwaHandoff?: Readonly<{
      handoffIdDigest: Uint8Array;
      verifierDigest: Uint8Array;
      expiresAt: Date;
    }>;
  }): Promise<void> {
    await prisma.$transaction(async (transaction) => {
      await transaction.magicLinkChallenge.create({
        data: {
          normalizedEmail: input.challenge.email,
          tokenDigest: Buffer.from(input.tokenDigest),
          client: input.challenge.client,
          returnPath: input.challenge.returnPath,
          expiresAt: input.expiresAt,
        },
      });
      if (input.pwaHandoff)
        await transaction.pwaAuthenticationHandoff.create({
          data: {
            handoffIdDigest: Buffer.from(input.pwaHandoff.handoffIdDigest),
            verifierDigest: Buffer.from(input.pwaHandoff.verifierDigest),
            normalizedEmail: input.challenge.email,
            returnPath: input.challenge.returnPath,
            expiresAt: input.pwaHandoff.expiresAt,
          },
        });
    });
  }

  public async consumeChallenge(
    tokenDigest: Uint8Array,
    client: PasswordlessClient,
    now: Date,
  ): Promise<MagicLinkChallenge | null> {
    return prisma.$transaction(async (transaction) => {
      const candidate = await transaction.magicLinkChallenge.findUnique({
        where: { tokenDigest: Buffer.from(tokenDigest) },
      });
      if (
        !candidate ||
        candidate.client !== client ||
        candidate.consumedAt !== null ||
        candidate.expiresAt.getTime() <= now.getTime()
      )
        return null;
      const deletion = await transaction.accountDeletionIdentity.findFirst({
        where: {
          normalizedEmail: candidate.normalizedEmail,
          deletionRecord: { completedAt: { gte: candidate.createdAt } },
        },
        orderBy: { deletedAt: "desc" },
        select: { deletedAt: true },
      });
      if (deletion && deletion.deletedAt.getTime() >= candidate.createdAt.getTime()) return null;
      const consumed = await transaction.magicLinkChallenge.updateMany({
        where: {
          id: candidate.id,
          client,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) return null;
      return {
        email: candidate.normalizedEmail,
        client,
        returnPath: candidate.returnPath as MagicLinkChallenge["returnPath"],
      };
    });
  }

  public async findOrCreateAccount(email: string, now: Date): Promise<PasswordlessAccount> {
    try {
      return await prisma.$transaction(async (transaction) => {
        const existing = await transaction.passwordlessIdentity.findUnique({
          where: { normalizedEmail: email },
          include: { externalIdentity: { include: { applicationUser: true } } },
        });
        if (existing) {
          await transaction.externalIdentity.update({
            where: { id: existing.externalIdentityId },
            data: { email, emailVerifiedAt: now },
          });
          await transaction.applicationUser.update({
            where: { id: existing.externalIdentity.applicationUserId },
            data: { email },
          });
          return toAccount(existing.externalIdentity.applicationUser.id, existing.externalIdentity.subject, email);
        }

        const subject = randomUUID();
        const created = await transaction.applicationUser.create({
          data: {
            email,
            externalIdentities: {
              create: {
                issuer: PASSWORDLESS_ISSUER,
                subject,
                email,
                emailVerifiedAt: now,
                passwordlessIdentity: {
                  create: { normalizedEmail: email },
                },
              },
            },
          },
          include: {
            externalIdentities: {
              where: { issuer: PASSWORDLESS_ISSUER },
            },
          },
        });
        const identity = created.externalIdentities[0];
        if (!identity) throw new Error("Passwordless identity creation failed.");
        return toAccount(created.id, identity.subject, email);
      });
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error;
      const raced = await prisma.passwordlessIdentity.findUnique({
        where: { normalizedEmail: email },
        include: { externalIdentity: { include: { applicationUser: true } } },
      });
      if (!raced) throw error;
      await prisma.$transaction([
        prisma.externalIdentity.update({
          where: { id: raced.externalIdentityId },
          data: { email, emailVerifiedAt: now },
        }),
        prisma.applicationUser.update({
          where: { id: raced.externalIdentity.applicationUserId },
          data: { email },
        }),
      ]);
      return toAccount(raced.externalIdentity.applicationUser.id, raced.externalIdentity.subject, email);
    }
  }

  public async createSession(account: PasswordlessAccount, now: Date): Promise<PasswordlessSession> {
    return prisma.$transaction((transaction) => this.createSessionInTransaction(transaction, account, now));
  }

  public async publishPwaHandoff(
    tokenDigest: Uint8Array,
    sessionId: string,
    handoffIdDigest: Uint8Array,
    now: Date,
  ): Promise<boolean> {
    return prisma.$transaction(async (transaction) => {
      const candidate = await transaction.authSession.findUnique({
        where: { id: sessionId },
        select: {
          applicationUserId: true,
          refreshTokenDigest: true,
          revokedAt: true,
          refreshExpiresAt: true,
          applicationUser: {
            select: {
              externalIdentities: {
                where: { issuer: PASSWORDLESS_ISSUER },
                select: { email: true },
                take: 1,
              },
            },
          },
        },
      });
      const sessionEmail = candidate?.applicationUser.externalIdentities[0]?.email;
      const normalizedSessionEmail = sessionEmail ? normalizeEmail(sessionEmail) : null;
      if (
        !candidate ||
        !normalizedSessionEmail ||
        candidate.revokedAt !== null ||
        candidate.refreshExpiresAt.getTime() <= now.getTime()
      )
        return false;
      const expectedDigest = Buffer.from(tokenDigest);
      if (!expectedDigest.equals(Buffer.from(candidate.refreshTokenDigest))) {
        await recordRefreshReuse(transaction, candidate.applicationUserId, sessionId, now);
        return false;
      }
      const reserved = await transaction.pwaAuthenticationHandoff.updateMany({
        where: {
          handoffIdDigest: Buffer.from(handoffIdDigest),
          normalizedEmail: normalizedSessionEmail,
          sessionId: null,
          publishedAt: null,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { sessionId },
      });
      if (reserved.count !== 1) return false;
      const session = await this.rotateRefreshTokenInTransaction(transaction, tokenDigest, sessionId, now);
      if (!session) {
        await transaction.pwaAuthenticationHandoff.updateMany({
          where: { handoffIdDigest: Buffer.from(handoffIdDigest), sessionId, publishedAt: null, consumedAt: null },
          data: { sessionId: null },
        });
        return false;
      }
      const published = await transaction.pwaAuthenticationHandoff.updateMany({
        where: { handoffIdDigest: Buffer.from(handoffIdDigest), sessionId, publishedAt: null, consumedAt: null },
        data: { publishedAt: now },
      });
      if (published.count !== 1) throw new Error("PWA authentication handoff is invalid.");
      return true;
    });
  }

  public async redeemPwaHandoff(
    handoffIdDigest: Uint8Array,
    verifierDigest: Uint8Array,
    now: Date,
  ): Promise<Readonly<{ session: PasswordlessSession; returnPath: PasswordlessReturnPath }> | null> {
    return prisma.$transaction(async (transaction) => {
      const handoff = await transaction.pwaAuthenticationHandoff.findUnique({
        where: { handoffIdDigest: Buffer.from(handoffIdDigest) },
        include: {
          session: {
            include: {
              applicationUser: {
                include: { externalIdentities: { where: { issuer: PASSWORDLESS_ISSUER } } },
              },
            },
          },
        },
      });
      const session = handoff?.session;
      const identity = session?.applicationUser.externalIdentities[0];
      if (
        !handoff ||
        !session ||
        !identity ||
        !equalDigests(handoff.verifierDigest, verifierDigest) ||
        handoff.consumedAt !== null ||
        handoff.publishedAt === null ||
        handoff.expiresAt.getTime() <= now.getTime() ||
        session.revokedAt !== null ||
        session.refreshExpiresAt.getTime() <= now.getTime() ||
        session.applicationUser.status !== "ACTIVE" ||
        !identity.email ||
        identity.emailVerifiedAt === null
      )
        return null;
      const consumed = await transaction.pwaAuthenticationHandoff.updateMany({
        where: {
          id: handoff.id,
          consumedAt: null,
          publishedAt: { not: null },
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) return null;
      const account = toAccount(session.applicationUser.id, identity.subject, identity.email);
      return {
        session: await this.createSessionInTransaction(transaction, account, now),
        returnPath: handoff.returnPath as PasswordlessReturnPath,
      };
    });
  }

  public async verifyAccessToken(tokenDigest: Uint8Array, now: Date): Promise<VerifiedPrincipal | null> {
    const session = await prisma.authSession.findUnique({
      where: { accessTokenDigest: Buffer.from(tokenDigest) },
      include: {
        applicationUser: {
          include: {
            externalIdentities: {
              where: { issuer: PASSWORDLESS_ISSUER },
            },
          },
        },
      },
    });
    const identity = session?.applicationUser.externalIdentities[0];
    if (
      !session ||
      !identity ||
      session.revokedAt !== null ||
      session.accessExpiresAt.getTime() <= now.getTime() ||
      session.applicationUser.status !== "ACTIVE" ||
      !identity.email ||
      identity.emailVerifiedAt === null
    )
      return null;
    await prisma.authSession.update({ where: { id: session.id }, data: { lastUsedAt: now } });
    return {
      issuer: identity.issuer,
      subject: identity.subject,
      email: identity.email,
      emailVerified: identity.emailVerifiedAt !== null,
      assurance: "active-session",
      sessionId: session.id,
      issuedAt: session.createdAt,
    };
  }

  public async verifyBrowserSession(sessionId: string, now: Date): Promise<VerifiedPrincipal | null> {
    const session = await prisma.authSession.findUnique({
      where: { id: sessionId },
      include: {
        applicationUser: {
          include: { externalIdentities: { where: { issuer: PASSWORDLESS_ISSUER } } },
        },
      },
    });
    const identity = session?.applicationUser.externalIdentities[0];
    if (
      !session ||
      !identity ||
      session.revokedAt !== null ||
      session.refreshExpiresAt.getTime() <= now.getTime() ||
      session.applicationUser.status !== "ACTIVE" ||
      !identity.email ||
      identity.emailVerifiedAt === null
    )
      return null;
    return {
      issuer: identity.issuer,
      subject: identity.subject,
      email: identity.email,
      emailVerified: identity.emailVerifiedAt !== null,
      assurance: "active-session",
      sessionId: session.id,
      issuedAt: session.createdAt,
    };
  }

  public async rotateRefreshToken(
    tokenDigest: Uint8Array,
    sessionId: string,
    now: Date,
  ): Promise<PasswordlessSession | null> {
    return prisma.$transaction((transaction) =>
      this.rotateRefreshTokenInTransaction(transaction, tokenDigest, sessionId, now),
    );
  }

  private async rotateRefreshTokenInTransaction(
    transaction: Prisma.TransactionClient,
    tokenDigest: Uint8Array,
    sessionId: string,
    now: Date,
  ): Promise<PasswordlessSession | null> {
    const expectedDigest = Buffer.from(tokenDigest);
    const session = await transaction.authSession.findUnique({
      where: { id: sessionId },
      include: {
        applicationUser: {
          include: {
            externalIdentities: {
              where: { issuer: PASSWORDLESS_ISSUER },
            },
          },
        },
      },
    });
    const identity = session?.applicationUser.externalIdentities[0];
    if (
      !session ||
      !identity ||
      session.revokedAt !== null ||
      session.refreshExpiresAt.getTime() <= now.getTime() ||
      session.applicationUser.status !== "ACTIVE" ||
      !identity.email ||
      identity.emailVerifiedAt === null
    )
      return null;
    if (!expectedDigest.equals(Buffer.from(session.refreshTokenDigest))) {
      await recordRefreshReuse(transaction, session.applicationUserId, session.id, now);
      return null;
    }

    const accessToken = createSessionCredential(session.id);
    const refreshToken = createSessionCredential(session.id);
    const accessExpiresAt = new Date(now.getTime() + this.configuration.accessTokenTtlSeconds * 1_000);
    const updated = await transaction.authSession.updateMany({
      where: { id: session.id, refreshTokenDigest: expectedDigest, revokedAt: null },
      data: {
        accessTokenDigest: Buffer.from(this.digestCredential(accessToken)),
        refreshTokenDigest: Buffer.from(this.digestCredential(refreshToken)),
        accessExpiresAt,
        refreshRotatedAt: now,
        lastUsedAt: now,
      },
    });
    if (updated.count !== 1) {
      await recordRefreshReuse(transaction, session.applicationUserId, session.id, now);
      return null;
    }
    const account = toAccount(session.applicationUser.id, identity.subject, identity.email);
    return {
      sessionId: session.id,
      accessToken,
      refreshToken,
      accessExpiresAt,
      refreshExpiresAt: session.refreshExpiresAt,
      principal: { ...passwordlessPrincipal(account, "active-session", session.createdAt), sessionId: session.id },
    };
  }

  public async revokeSession(sessionId: string, now: Date, reason = "logout"): Promise<void> {
    await prisma.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: now, revocationReason: reason },
    });
  }

  private async createSessionInTransaction(
    transaction: Prisma.TransactionClient,
    account: PasswordlessAccount,
    now: Date,
  ): Promise<PasswordlessSession> {
    const sessionId = randomSessionId();
    const accessToken = createSessionCredential(sessionId);
    const refreshToken = createSessionCredential(sessionId);
    const accessExpiresAt = new Date(now.getTime() + this.configuration.accessTokenTtlSeconds * 1_000);
    const refreshExpiresAt = new Date(now.getTime() + this.configuration.refreshTokenTtlSeconds * 1_000);
    await transaction.authSession.create({
      data: {
        id: sessionId,
        applicationUserId: account.applicationUserId,
        accessTokenDigest: Buffer.from(this.digestCredential(accessToken)),
        refreshTokenDigest: Buffer.from(this.digestCredential(refreshToken)),
        refreshFamily: sessionId,
        accessExpiresAt,
        refreshExpiresAt,
      },
    });
    return {
      sessionId,
      accessToken,
      refreshToken,
      accessExpiresAt,
      refreshExpiresAt,
      principal: { ...passwordlessPrincipal(account, "active-session", now), sessionId },
    };
  }

  private digestCredential(token: string): Uint8Array {
    return new Uint8Array(createHmac("sha256", this.configuration.sessionSecret).update(token, "utf8").digest());
  }
}

async function recordRefreshReuse(
  transaction: Prisma.TransactionClient,
  applicationUserId: string,
  sessionId: string,
  now: Date,
): Promise<void> {
  const revoked = await transaction.authSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: {
      revokedAt: now,
      revocationReason: "refresh_reuse_detected",
      reuseDetectedAt: now,
    },
  });
  if (revoked.count !== 1) return;
  await transaction.identitySecurityEvent.create({
    data: {
      applicationUserId,
      sessionId,
      eventType: "refresh_token_reuse_detected",
    },
  });
}

function equalDigests(left: Uint8Array, right: Uint8Array): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function toAccount(applicationUserId: string, subject: string, email: string): PasswordlessAccount {
  return { applicationUserId, issuer: PASSWORDLESS_ISSUER, subject, email };
}

function randomSessionId(): string {
  return randomUUID().replace(/-/g, "");
}

function isUniqueConstraintViolation(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
