import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";
import { publicEncryptionKeySchema } from "@api/http/public-encryption-key";
import { invitationExpiresAt, invitationIsExpired } from "../domain/invitation-expiry";
import {
  InvitationConflictError,
  InvitationRecipientUnavailableError,
  MAX_INVITATION_RECIPIENT_EMAIL_LENGTH,
  SecureShareLinkUnavailableError,
  StaleRecipientEncryptionIdentityError,
  type NewSecureShareLink,
  type RedeemableSecureShareLink,
  type SecureShareLinkRecipient,
  type SecureShareLinkRepository,
} from "../application/secure-share-link-repository";

export class PrismaSecureShareLinkRepository implements SecureShareLinkRepository {
  public constructor(
    private readonly database: PrismaDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async create(
    ownerId: string,
    vaultId: string,
    link: NewSecureShareLink,
  ): ReturnType<SecureShareLinkRepository["create"]> {
    const recipient = await this.database.applicationUser.findUnique({
      where: { id: link.recipientUserId },
      select: { email: true },
    });
    if (!recipient) throw new InvitationRecipientUnavailableError("Invitation recipient is unavailable.");
    return this.createForEmail(ownerId, vaultId, recipient.email, link);
  }

  public async createForEmail(
    ownerId: string,
    vaultId: string,
    recipientEmail: string,
    link: Omit<NewSecureShareLink, "recipientUserId">,
  ): ReturnType<SecureShareLinkRepository["createForEmail"]> {
    const normalizedEmail = normalizeEmail(recipientEmail);
    if (normalizedEmail.length > MAX_INVITATION_RECIPIENT_EMAIL_LENGTH)
      throw new InvitationRecipientUnavailableError("Invitation recipient is unavailable.");
    const now = this.now();
    const expiresAt = invitationExpiresAt(now);
    return this.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${vaultId}:${normalizedEmail}`}))`;
      const vaultLock = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "vaults"
        WHERE "id" = ${vaultId}
          AND "owner_id" = ${ownerId}
          AND "type" = 'SHARED'
          AND "lifecycle" = 'ACTIVE'
          AND "deleted_at" IS NULL
        FOR UPDATE
      `;
      if (!vaultLock[0]) throw new InvitationRecipientUnavailableError("Invitation recipient is unavailable.");
      const [vault, recipient, ownerMembership] = await Promise.all([
        transaction.vault.findFirst({
          where: { id: vaultId, ownerId, type: "SHARED", lifecycle: "ACTIVE", deletedAt: null },
          select: { id: true, owner: { select: { email: true } } },
        }),
        transaction.applicationUser.findFirst({
          where: { email: { equals: normalizedEmail, mode: "insensitive" }, status: "ACTIVE" },
          select: { id: true },
        }),
        transaction.vaultMember.findUnique({
          where: { vaultId_userId: { vaultId, userId: ownerId } },
          select: { role: true, status: true, keyVersion: true },
        }),
      ]);
      if (!vault || normalizeEmail(vault.owner.email) === normalizedEmail)
        throw new InvitationRecipientUnavailableError("Invitation recipient is unavailable.");
      if (
        ownerMembership?.role !== "OWNER" ||
        ownerMembership.status !== "ACTIVE" ||
        ownerMembership.keyVersion !== link.expectedKeyVersion
      )
        throw new InvitationConflictError("Vault Encryption Key generation changed before invitation creation.");
      const recipientBindings = [
        { recipientEmail: normalizedEmail },
        ...(recipient ? [{ recipientUserId: recipient.id }] : []),
      ];
      const [membership, pendingInvitations] = await Promise.all([
        recipient
          ? transaction.vaultMember.findUnique({
              where: { vaultId_userId: { vaultId, userId: recipient.id } },
              select: { status: true },
            })
          : null,
        transaction.vaultInvitation.findMany({
          where: { vaultId, status: "PENDING", OR: recipientBindings },
          select: { id: true, expiresAt: true },
        }),
      ]);
      if (
        membership?.status === "ACTIVE" ||
        pendingInvitations.some((invitation) => !invitationIsExpired(invitation.expiresAt, now))
      ) {
        throw new InvitationConflictError(
          "Invitation recipient already has access or an unexpired pending invitation.",
        );
      }
      const expiredIds = pendingInvitations.map(({ id }) => id);
      if (expiredIds.length)
        await transaction.vaultInvitation.deleteMany({ where: { id: { in: expiredIds }, status: "PENDING" } });
      const invitation = await transaction.vaultInvitation.create({
        data: {
          vaultId,
          recipientEmail: normalizedEmail,
          recipientUserId: recipient?.id,
          linkVerifier: copyBytes(link.linkVerifier),
          encryptedPackage: copyBytes(link.encryptedPackage),
          expiresAt,
        },
        select: { id: true, expiresAt: true },
      });
      return invitation;
    });
  }

  public async findForRecipient(
    recipient: SecureShareLinkRecipient,
    linkVerifier: Uint8Array,
  ): Promise<RedeemableSecureShareLink | null> {
    const invitation = await this.database.vaultInvitation.findFirst({
      where: {
        linkVerifier: copyBytes(linkVerifier),
        status: "PENDING",
        expiresAt: { gt: this.now() },
        OR: recipientBindings(recipient),
        vault: { type: "SHARED", lifecycle: "ACTIVE", deletedAt: null },
      },
      select: {
        id: true,
        vaultId: true,
        encryptedPackage: true,
        vault: {
          select: {
            members: {
              where: { role: "OWNER", status: "ACTIVE" },
              take: 1,
              select: { keyVersion: true },
            },
          },
        },
      },
    });
    const keyVersion = invitation?.vault.members[0]?.keyVersion;
    return invitation && keyVersion && Number.isSafeInteger(keyVersion) && keyVersion > 0
      ? {
          id: invitation.id,
          vaultId: invitation.vaultId,
          encryptedPackage: copyBytes(invitation.encryptedPackage),
          keyVersion,
        }
      : null;
  }

  public async redeem(
    recipient: SecureShareLinkRecipient,
    invitationId: string,
    encryptedVaultKey: Uint8Array,
    keyVersion: number,
    expectedPublicKey: JsonWebKey,
  ): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${recipient.userId}))`;
      const profile = await transaction.userCryptoProfile.findUnique({
        where: { userId: recipient.userId },
        select: { userEncryptionPublicKey: true },
      });
      if (!profile || !samePublicKey(profile.userEncryptionPublicKey, expectedPublicKey))
        throw new StaleRecipientEncryptionIdentityError("User Encryption identity changed.");
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${invitationId}))`;
      const invitation = await transaction.vaultInvitation.findFirst({
        where: {
          id: invitationId,
          status: "PENDING",
          expiresAt: { gt: this.now() },
          OR: recipientBindings(recipient),
          vault: { type: "SHARED", lifecycle: "ACTIVE", deletedAt: null },
        },
      });
      if (!invitation) throw new SecureShareLinkUnavailableError("Secure Share Link is unavailable.");
      const vault = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "vaults"
        WHERE "id" = ${invitation.vaultId}
          AND "type" = 'SHARED'
          AND "lifecycle" = 'ACTIVE'
          AND "deleted_at" IS NULL
        FOR UPDATE
      `;
      if (!vault[0]) throw new SecureShareLinkUnavailableError("Secure Share Link is unavailable.");
      const ownerMembership = await transaction.vaultMember.findFirst({
        where: { vaultId: invitation.vaultId, role: "OWNER", status: "ACTIVE" },
        select: { keyVersion: true },
      });
      if (!ownerMembership || ownerMembership.keyVersion !== keyVersion)
        throw new SecureShareLinkUnavailableError("Secure Share Link is unavailable.");
      const currentInvitation = await transaction.vaultInvitation.findFirst({
        where: {
          id: invitation.id,
          status: "PENDING",
          expiresAt: { gt: this.now() },
          OR: recipientBindings(recipient),
          vault: { type: "SHARED", lifecycle: "ACTIVE", deletedAt: null },
        },
      });
      if (!currentInvitation) throw new SecureShareLinkUnavailableError("Secure Share Link is unavailable.");
      const existingMembership = await transaction.vaultMember.findUnique({
        where: { vaultId_userId: { vaultId: invitation.vaultId, userId: recipient.userId } },
      });
      if (existingMembership) {
        if (existingMembership.role !== "VIEWER" || existingMembership.status === "ACTIVE") {
          throw new SecureShareLinkUnavailableError("Secure Share Link cannot replace the existing membership.");
        }
        await transaction.vaultMember.update({
          where: { vaultId_userId: { vaultId: invitation.vaultId, userId: recipient.userId } },
          data: {
            status: "ACTIVE",
            encryptedVaultKey: copyBytes(encryptedVaultKey),
            keyVersion,
            revokedAt: null,
            canAddAccountsOverride: null,
            canEditAccountsOverride: null,
            canDeleteAccountsOverride: null,
            permissionsRevision: { increment: 1 },
          },
        });
      } else {
        await transaction.vaultMember.create({
          data: {
            vaultId: invitation.vaultId,
            userId: recipient.userId,
            role: "VIEWER",
            encryptedVaultKey: copyBytes(encryptedVaultKey),
            keyVersion,
          },
        });
      }
      await transaction.vaultInvitation.update({
        where: { id: currentInvitation.id },
        data: { recipientUserId: recipient.userId, status: "REDEEMED", redeemedAt: new Date() },
      });
    });
  }
}

function recipientBindings(recipient: SecureShareLinkRecipient) {
  return [
    { recipientUserId: recipient.userId },
    { recipientUserId: null, recipientEmail: normalizeEmail(recipient.email) },
  ];
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function samePublicKey(value: unknown, expected: JsonWebKey): boolean {
  const parsed = publicEncryptionKeySchema.safeParse(value);
  if (!parsed.success) return false;
  const current = parsed.data;
  return (
    current.kty === expected.kty &&
    current.crv === expected.crv &&
    current.x === expected.x &&
    current.y === expected.y &&
    current.ext === expected.ext &&
    JSON.stringify(current.key_ops) === JSON.stringify(expected.key_ops)
  );
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}
