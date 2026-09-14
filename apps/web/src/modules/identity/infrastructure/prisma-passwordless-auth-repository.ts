import { Prisma } from "@prisma/client";
import { createHmac, randomUUID } from "node:crypto";
import {
  PASSWORDLESS_ISSUER,
  passwordlessPrincipal,
  type MagicLinkChallenge,
  type PasswordlessAccount,
  type PasswordlessAuthRepository,
  type PasswordlessClient,
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
  }): Promise<void> {
    await prisma.magicLinkChallenge.create({
      data: {
        normalizedEmail: input.challenge.email,
        tokenDigest: Buffer.from(input.tokenDigest),
        client: input.challenge.client,
        returnPath: input.challenge.returnPath,
        expiresAt: input.expiresAt,
      },
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
    const sessionId = randomSessionId();
    const accessToken = createSessionCredential(sessionId);
    const refreshToken = createSessionCredential(sessionId);
    const accessExpiresAt = new Date(now.getTime() + this.configuration.accessTokenTtlSeconds * 1_000);
    const refreshExpiresAt = new Date(now.getTime() + this.configuration.refreshTokenTtlSeconds * 1_000);
    await prisma.authSession.create({
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
      principal: { ...passwordlessPrincipal(account, "active-session"), sessionId },
    };
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
    };
  }

  public async rotateRefreshToken(
    tokenDigest: Uint8Array,
    sessionId: string,
    now: Date,
  ): Promise<PasswordlessSession | null> {
    const expectedDigest = Buffer.from(tokenDigest);
    return prisma.$transaction(async (transaction) => {
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
        principal: { ...passwordlessPrincipal(account, "active-session"), sessionId: session.id },
      };
    });
  }

  public async revokeSession(sessionId: string, now: Date, reason = "logout"): Promise<void> {
    await prisma.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: now, revocationReason: reason },
    });
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

function toAccount(applicationUserId: string, subject: string, email: string): PasswordlessAccount {
  return { applicationUserId, issuer: PASSWORDLESS_ISSUER, subject, email };
}

function randomSessionId(): string {
  return randomUUID().replace(/-/g, "");
}

function isUniqueConstraintViolation(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
