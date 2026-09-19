import { constantTimeEqual, hmacSha256, randomBase64Url, randomInt } from "@api/shared/infrastructure/crypto";
import { Buffer } from "@api/shared/infrastructure/base64";
import { Prisma } from "@prisma/client";
import type {
  AccountDeletionChallengePurpose,
  AccountDeletionPreview,
  AccountDeletionRepository,
  AccountDeletionResult,
} from "../application/account-deletion-repository";
import type { AccountDeletionAuthBackend, AccountDeletionRequest } from "../domain/account-deletion-policy";
import {
  ACCOUNT_DELETION_AUTHORIZATION_TTL_SECONDS,
  ACCOUNT_DELETION_OTP_MAX_ATTEMPTS,
  ACCOUNT_DELETION_OTP_TTL_SECONDS,
  isValidOtp,
  validateAccountDeletionRequest,
} from "../domain/account-deletion-policy";
import {
  AccountDeletionAuthorizationError,
  AccountDeletionChallengeUnavailableError,
  AccountDeletionOtpInvalidError,
  AccountDeletionOtpLockedError,
  AccountDeletionPlanStaleError,
} from "../domain/account-deletion-errors";
import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";

const PASSWORDLESS_PURPOSE: AccountDeletionChallengePurpose = "PASSWORDLESS_OTP";
const OIDC_PURPOSE: AccountDeletionChallengePurpose = "OIDC_REAUTH";
const OTP_CONTEXT = "rhasia:account-deletion:otp:";
const AUTHORIZATION_CONTEXT = "rhasia:account-deletion:authorization:";

type DeletionRecord = Readonly<{
  id: string;
  email: string;
  emailDeliveryStatus: string;
  authBackend: string;
  personalVaultCount: number;
  sharedVaultDeletedCount: number;
  sharedVaultTransferredCount: number;
  authenticatorAccountCount: number;
}>;

export class PrismaAccountDeletionRepository implements AccountDeletionRepository {
  public constructor(
    private readonly secret: Uint8Array,
    private readonly database: PrismaDatabase,
    private readonly anonymousAuthSecret: Uint8Array = secret,
  ) {}

  public async getPreview(applicationUserId: string): Promise<AccountDeletionPreview> {
    const [personalVault, sharedVaults] = await Promise.all([
      this.database.vault.findFirst({
        where: { ownerId: applicationUserId, type: "PERSONAL" },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      }),
      this.database.vault.findMany({
        where: { ownerId: applicationUserId, type: "SHARED" },
        select: {
          id: true,
          lifecycle: true,
          members: {
            where: { role: "VIEWER", status: "ACTIVE", user: { status: "ACTIVE" } },
            select: { userId: true, user: { select: { email: true } }, encryptedVaultKey: true, keyVersion: true },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    return {
      personalVaultId: personalVault?.id ?? null,
      ownedSharedVaults: sharedVaults.map((vault) => ({
        id: vault.id,
        lifecycle: vault.lifecycle,
        viewerCandidates:
          vault.lifecycle === "ACTIVE"
            ? vault.members.flatMap((member) =>
                member.encryptedVaultKey && member.keyVersion ? [{ id: member.userId, email: member.user.email }] : [],
              )
            : [],
      })),
    };
  }

  public async createPasswordlessOtpChallenge(
    applicationUserId: string,
    now: Date,
  ): Promise<Readonly<{ challengeId: string; otp: string }>> {
    const otp = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const authorizationSeed = randomBase64Url(32);
    const expiresAt = new Date(now.getTime() + ACCOUNT_DELETION_OTP_TTL_SECONDS * 1_000);
    const created = await this.database.$transaction(async (transaction) => {
      await this.removeOpenChallenges(transaction, applicationUserId, PASSWORDLESS_PURPOSE);
      return transaction.accountDeletionChallenge.create({
        data: {
          applicationUserId,
          purpose: PASSWORDLESS_PURPOSE,
          otpDigest: this.digest(OTP_CONTEXT, otp),
          authorizationDigest: this.digest(AUTHORIZATION_CONTEXT, authorizationSeed),
          expiresAt,
        },
        select: { id: true },
      });
    });
    return { challengeId: created.id, otp };
  }

  public async verifyPasswordlessOtp(
    applicationUserId: string,
    otp: string,
    now: Date,
  ): Promise<Readonly<{ authorizationToken: string }>> {
    if (!isValidOtp(otp)) throw new AccountDeletionOtpInvalidError();
    const authorizationToken = randomBase64Url(32);
    const result = await this.database.$transaction(async (transaction) => {
      const challenge = await transaction.accountDeletionChallenge.findFirst({
        where: {
          applicationUserId,
          purpose: PASSWORDLESS_PURPOSE,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: "desc" },
      });
      if (!challenge) return "unavailable" as const;
      if (challenge.attemptCount >= ACCOUNT_DELETION_OTP_MAX_ATTEMPTS) return "locked" as const;
      const expected = challenge.otpDigest;
      if (!expected || !this.equalDigests(expected, this.digest(OTP_CONTEXT, otp))) {
        const updated = await transaction.accountDeletionChallenge.updateMany({
          where: { id: challenge.id, consumedAt: null, attemptCount: { lt: ACCOUNT_DELETION_OTP_MAX_ATTEMPTS } },
          data: { attemptCount: { increment: 1 } },
        });
        return updated.count === 1 ? ("invalid" as const) : ("locked" as const);
      }
      const updated = await transaction.accountDeletionChallenge.updateMany({
        where: {
          id: challenge.id,
          consumedAt: null,
          expiresAt: { gt: now },
          attemptCount: { lt: ACCOUNT_DELETION_OTP_MAX_ATTEMPTS },
        },
        data: {
          consumedAt: now,
          verifiedAt: now,
          authorizationDigest: this.digest(AUTHORIZATION_CONTEXT, authorizationToken),
        },
      });
      return updated.count === 1 ? ("verified" as const) : ("unavailable" as const);
    });
    if (result === "locked") throw new AccountDeletionOtpLockedError();
    if (result === "invalid") throw new AccountDeletionOtpInvalidError();
    if (result !== "verified") throw new AccountDeletionChallengeUnavailableError();
    return { authorizationToken };
  }

  public async createOidcReauthenticationChallenge(applicationUserId: string, now: Date): Promise<string> {
    const expiresAt = new Date(now.getTime() + ACCOUNT_DELETION_AUTHORIZATION_TTL_SECONDS * 1_000);
    const created = await this.database.$transaction(async (transaction) => {
      await this.removeOpenChallenges(transaction, applicationUserId, OIDC_PURPOSE);
      return transaction.accountDeletionChallenge.create({
        data: {
          applicationUserId,
          purpose: OIDC_PURPOSE,
          authorizationDigest: this.digest(AUTHORIZATION_CONTEXT, randomBase64Url(32)),
          expiresAt,
        },
        select: { id: true },
      });
    });
    return created.id;
  }

  public async completeOidcReauthentication(
    challengeId: string,
    issuer: string,
    subject: string,
    now: Date,
  ): Promise<Readonly<{ authorizationToken: string }>> {
    const authorizationToken = randomBase64Url(32);
    await this.database.$transaction(async (transaction) => {
      const challenge = await transaction.accountDeletionChallenge.findUnique({ where: { id: challengeId } });
      const identity = await transaction.externalIdentity.findUnique({
        where: { issuer_subject: { issuer, subject } },
        select: { applicationUserId: true },
      });
      if (
        !challenge ||
        !identity ||
        challenge.applicationUserId !== identity.applicationUserId ||
        challenge.purpose !== OIDC_PURPOSE ||
        challenge.verifiedAt !== null ||
        challenge.consumedAt !== null ||
        challenge.expiresAt.getTime() <= now.getTime()
      )
        throw new AccountDeletionAuthorizationError("OIDC reauthentication did not match the deleting user.");
      const updated = await transaction.accountDeletionChallenge.updateMany({
        where: { id: challenge.id, verifiedAt: null, consumedAt: null, expiresAt: { gt: now } },
        data: {
          verifiedAt: now,
          authorizationDigest: this.digest(AUTHORIZATION_CONTEXT, authorizationToken),
        },
      });
      if (updated.count !== 1) throw new AccountDeletionChallengeUnavailableError();
    });
    return { authorizationToken };
  }

  public async findCompletedDeletion(authorizationToken: string) {
    const challenge = await this.database.accountDeletionChallenge.findUnique({
      where: { authorizationDigest: this.digest(AUTHORIZATION_CONTEXT, authorizationToken) },
      select: { completedDeletionId: true },
    });
    if (!challenge?.completedDeletionId) return null;
    const record = await this.database.accountDeletionRecord.findUnique({
      where: { id: challenge.completedDeletionId },
      select: { id: true, emailDeliveryStatus: true },
    });
    return record ? { receiptId: record.id, emailDeliveryStatus: record.emailDeliveryStatus } : null;
  }

  public async deleteUser(
    applicationUserId: string,
    authorizationToken: string,
    authBackend: AccountDeletionAuthBackend,
    request: AccountDeletionRequest,
    now: Date,
  ): Promise<AccountDeletionResult> {
    validateAccountDeletionRequest(request);
    const authorizationDigest = this.digest(AUTHORIZATION_CONTEXT, authorizationToken);
    return this.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${applicationUserId}))`;
      const challenge = await transaction.accountDeletionChallenge.findUnique({
        where: { authorizationDigest },
      });
      if (
        !challenge ||
        challenge.applicationUserId !== applicationUserId ||
        challenge.verifiedAt === null ||
        challenge.expiresAt.getTime() <= now.getTime()
      )
        throw new AccountDeletionAuthorizationError();
      if (challenge.completedDeletionId) {
        const record = await transaction.accountDeletionRecord.findUnique({
          where: { id: challenge.completedDeletionId },
        });
        if (record) return toDeletionResult(record);
        throw new AccountDeletionAuthorizationError();
      }
      const user = await transaction.applicationUser.findUnique({
        where: { id: applicationUserId },
        select: { id: true, email: true, externalIdentities: { select: { issuer: true, subject: true, email: true } } },
      });
      if (!user) throw new AccountDeletionAuthorizationError();

      const [personalVaults, sharedVaults] = await Promise.all([
        transaction.vault.findMany({ where: { ownerId: applicationUserId, type: "PERSONAL" }, select: { id: true } }),
        transaction.vault.findMany({
          where: { ownerId: applicationUserId, type: "SHARED" },
          select: { id: true, lifecycle: true },
        }),
      ]);
      const decisions = new Map(request.vaultDecisions.map((decision) => [decision.vaultId, decision]));
      if (decisions.size !== sharedVaults.length || sharedVaults.some(({ id }) => !decisions.has(id)))
        throw new AccountDeletionPlanStaleError();

      const deletedSharedVaultIds = sharedVaults
        .filter(({ id }) => decisions.get(id)?.action === "DELETE")
        .map(({ id }) => id);
      const transferredSharedVaults = sharedVaults.filter(({ id }) => decisions.get(id)?.action === "TRANSFER");
      const deletedVaultIds = [...personalVaults.map(({ id }) => id), ...deletedSharedVaultIds];
      for (const vault of transferredSharedVaults) {
        const decision = decisions.get(vault.id);
        if (!decision || decision.action !== "TRANSFER" || !decision.transferToUserId || vault.lifecycle !== "ACTIVE")
          throw new AccountDeletionPlanStaleError();
        await transferVault(transaction, applicationUserId, vault.id, decision.transferToUserId);
      }

      const authenticatorAccountCount = await transaction.authenticatorAccount.count({
        where: { vaultId: { in: deletedVaultIds } },
      });
      const deletionRecord = await transaction.accountDeletionRecord.create({
        data: {
          applicationUserId,
          email: user.email,
          authBackend,
          requestedAt: now,
          completedAt: now,
          emailDeliveryStatus: "PENDING",
          personalVaultCount: personalVaults.length,
          sharedVaultDeletedCount: deletedSharedVaultIds.length,
          sharedVaultTransferredCount: transferredSharedVaults.length,
          authenticatorAccountCount,
          identities: {
            create: user.externalIdentities.map((identity) => ({
              issuer: identity.issuer,
              subject: identity.subject,
              normalizedEmail: identity.email?.toLowerCase() ?? null,
              deletedAt: now,
            })),
          },
        },
      });

      await transaction.vaultAuditEvent.deleteMany({
        where: {
          OR: [
            { actorUserId: applicationUserId },
            { ownerId: applicationUserId },
            { targetId: applicationUserId },
            { vaultId: { in: deletedVaultIds } },
          ],
        },
      });
      await transaction.vaultInvitation.deleteMany({
        where: {
          OR: [
            { recipientUserId: applicationUserId },
            { recipientEmail: { equals: user.email, mode: "insensitive" } },
            ...(deletedVaultIds.length ? [{ vaultId: { in: deletedVaultIds } }] : []),
          ],
        },
      });
      await transaction.vaultMember.deleteMany({ where: { userId: applicationUserId } });
      await transaction.authenticatorAccount.deleteMany({ where: { vaultId: { in: deletedVaultIds } } });
      await transaction.vault.deleteMany({ where: { id: { in: deletedVaultIds } } });
      const identityEmails = [
        user.email.toLowerCase(),
        ...user.externalIdentities.flatMap((identity) => (identity.email ? [identity.email.toLowerCase()] : [])),
      ].filter((email, index, emails) => emails.indexOf(email) === index);
      await transaction.pwaAuthenticationHandoff.deleteMany({
        where: {
          OR: [{ session: { applicationUserId } }, { normalizedEmail: { in: identityEmails } }],
        },
      });
      await transaction.magicLinkChallenge.deleteMany({ where: { normalizedEmail: { in: identityEmails } } });
      for (const email of identityEmails) {
        await transaction.anonymousAuthRateLimitWindow.deleteMany({
          where: { operation: "magic-link-email", bucketHash: this.emailRateLimitBucket(email) },
        });
      }
      await transaction.passkeyRecoveryChallenge.deleteMany({ where: { userId: applicationUserId } });
      await transaction.passkeyRecoveryCredential.deleteMany({ where: { userId: applicationUserId } });
      await transaction.userCryptoProfile.deleteMany({ where: { userId: applicationUserId } });
      await transaction.applicationRateLimitWindow.deleteMany({ where: { userId: applicationUserId } });
      await transaction.identitySecurityEvent.deleteMany({ where: { applicationUserId } });
      await transaction.authSession.deleteMany({ where: { applicationUserId } });
      await transaction.accountDeletionChallenge.deleteMany({
        where: { applicationUserId, id: { not: challenge.id } },
      });
      await transaction.applicationUser.delete({ where: { id: applicationUserId } });
      await transaction.accountDeletionChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: now, completedDeletionId: deletionRecord.id },
      });
      await transaction.accountDeletionMetric.create({
        data: {
          authBackend,
          personalVaultCount: personalVaults.length,
          sharedVaultDeletedCount: deletedSharedVaultIds.length,
          sharedVaultTransferredCount: transferredSharedVaults.length,
          authenticatorAccountCount,
          occurredAt: now,
        },
      });
      return toDeletionResult(deletionRecord);
    });
  }

  public async recordCompletionEmailStatus(receiptId: string, status: "SENT" | "FAILED"): Promise<void> {
    await this.database.accountDeletionRecord.update({
      where: { id: receiptId },
      data: { emailDeliveryStatus: status },
    });
  }

  private async removeOpenChallenges(
    transaction: Prisma.TransactionClient,
    applicationUserId: string,
    purpose: AccountDeletionChallengePurpose,
  ): Promise<void> {
    await transaction.accountDeletionChallenge.deleteMany({
      where: { applicationUserId, purpose, verifiedAt: null, consumedAt: null },
    });
  }

  private digest(context: string, value: string): Uint8Array<ArrayBuffer> {
    return toArrayBuffer(hmacSha256(this.secret, context, value));
  }

  private emailRateLimitBucket(email: string): Uint8Array<ArrayBuffer> {
    return toArrayBuffer(hmacSha256(this.anonymousAuthSecret, `magic-link-email:${email.toLowerCase()}`));
  }

  private equalDigests(left: Uint8Array, right: Uint8Array): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && constantTimeEqual(leftBuffer, rightBuffer);
  }
}

async function transferVault(
  transaction: Prisma.TransactionClient,
  deletingUserId: string,
  vaultId: string,
  targetUserId: string,
): Promise<void> {
  if (targetUserId === deletingUserId) throw new AccountDeletionPlanStaleError();
  const target = await transaction.applicationUser.findUnique({
    where: { id: targetUserId },
    select: { status: true },
  });
  const targetMembership = await transaction.vaultMember.findUnique({
    where: { vaultId_userId: { vaultId, userId: targetUserId } },
    select: { role: true, status: true, encryptedVaultKey: true, keyVersion: true },
  });
  if (
    target?.status !== "ACTIVE" ||
    targetMembership?.role !== "VIEWER" ||
    targetMembership.status !== "ACTIVE" ||
    !targetMembership.encryptedVaultKey ||
    !targetMembership.keyVersion
  )
    throw new AccountDeletionPlanStaleError("Shared Vault transfer target is unavailable.");
  const promoted = await transaction.vaultMember.updateMany({
    where: { vaultId, userId: targetUserId, role: "VIEWER", status: "ACTIVE" },
    data: {
      role: "OWNER",
      canAddAccountsOverride: null,
      canEditAccountsOverride: null,
      canDeleteAccountsOverride: null,
      permissionsRevision: { increment: 1 },
    },
  });
  if (promoted.count !== 1) throw new AccountDeletionPlanStaleError();
  const owned = await transaction.vault.updateMany({
    where: { id: vaultId, ownerId: deletingUserId },
    data: { ownerId: targetUserId },
  });
  if (owned.count !== 1) throw new AccountDeletionPlanStaleError();
  await transaction.vaultMember.deleteMany({ where: { vaultId, userId: deletingUserId } });
}

function toArrayBuffer(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy;
}

function toDeletionResult(record: DeletionRecord): AccountDeletionResult {
  if (record.authBackend !== "passwordless" && record.authBackend !== "oidc")
    throw new Error("Account deletion record has an invalid authentication backend.");
  return {
    receiptId: record.id,
    email: record.email,
    authBackend: record.authBackend,
    personalVaultCount: record.personalVaultCount,
    sharedVaultDeletedCount: record.sharedVaultDeletedCount,
    sharedVaultTransferredCount: record.sharedVaultTransferredCount,
    authenticatorAccountCount: record.authenticatorAccountCount,
  };
}
