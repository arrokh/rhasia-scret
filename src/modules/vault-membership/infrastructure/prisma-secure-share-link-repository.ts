import { prisma } from "@/shared/infrastructure/prisma-client";
import {
  InvitationConflictError,
  InvitationRecipientUnavailableError,
  SecureShareLinkUnavailableError,
  type NewSecureShareLink,
  type RedeemableSecureShareLink,
  type SecureShareLinkRecipient,
  type SecureShareLinkRepository
} from "../application/secure-share-link-repository";

export class PrismaSecureShareLinkRepository implements SecureShareLinkRepository {
  public async create(ownerId: string, vaultId: string, link: NewSecureShareLink): Promise<{ id: string }> {
    const recipient = await prisma.applicationUser.findUnique({ where: { id: link.recipientUserId }, select: { email: true } });
    if (!recipient) throw new InvitationRecipientUnavailableError("Invitation recipient is unavailable.");
    return this.createForEmail(ownerId, vaultId, recipient.email, link);
  }

  public async createForEmail(ownerId: string, vaultId: string, recipientEmail: string, link: Omit<NewSecureShareLink, "recipientUserId">): Promise<{ id: string }> {
    const normalizedEmail = normalizeEmail(recipientEmail);
    return prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${vaultId}:${normalizedEmail}`}))`;
      const [vault, recipient] = await Promise.all([
        transaction.vault.findFirst({
          where: { id: vaultId, ownerId, type: "SHARED", lifecycle: "ACTIVE", deletedAt: null },
          select: { id: true, owner: { select: { email: true } } }
        }),
        transaction.applicationUser.findFirst({
          where: { email: { equals: normalizedEmail, mode: "insensitive" }, status: "ACTIVE" },
          select: { id: true }
        })
      ]);
      if (!vault || normalizeEmail(vault.owner.email) === normalizedEmail) throw new InvitationRecipientUnavailableError("Invitation recipient is unavailable.");
      const recipientBindings = [{ recipientEmail: normalizedEmail }, ...(recipient ? [{ recipientUserId: recipient.id }] : [])];
      const [membership, pendingInvitation] = await Promise.all([
        recipient ? transaction.vaultMember.findUnique({ where: { vaultId_userId: { vaultId, userId: recipient.id } }, select: { status: true } }) : null,
        transaction.vaultInvitation.findFirst({ where: { vaultId, status: "PENDING", OR: recipientBindings }, select: { id: true } })
      ]);
      if (membership?.status === "ACTIVE" || pendingInvitation) throw new InvitationConflictError("Invitation recipient already has access or a pending invitation.");
      const invitation = await transaction.vaultInvitation.create({
        data: {
          vaultId,
          recipientEmail: normalizedEmail,
          recipientUserId: recipient?.id,
          linkVerifier: copyBytes(link.linkVerifier),
          encryptedPackage: copyBytes(link.encryptedPackage)
        }
      });
      return { id: invitation.id };
    });
  }

  public async findForRecipient(recipient: SecureShareLinkRecipient, linkVerifier: Uint8Array): Promise<RedeemableSecureShareLink | null> {
    const invitation = await prisma.vaultInvitation.findFirst({
      where: {
        linkVerifier: copyBytes(linkVerifier),
        status: "PENDING",
        OR: recipientBindings(recipient),
        vault: { type: "SHARED", lifecycle: "ACTIVE", deletedAt: null }
      }
    });
    return invitation ? { id: invitation.id, vaultId: invitation.vaultId, encryptedPackage: copyBytes(invitation.encryptedPackage) } : null;
  }

  public async redeem(recipient: SecureShareLinkRecipient, invitationId: string, encryptedVaultKey: Uint8Array, keyVersion: number): Promise<void> {
    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${invitationId}))`;
      const invitation = await transaction.vaultInvitation.findFirst({
        where: { id: invitationId, status: "PENDING", OR: recipientBindings(recipient), vault: { type: "SHARED", lifecycle: "ACTIVE", deletedAt: null } }
      });
      if (!invitation) throw new SecureShareLinkUnavailableError("Secure Share Link is unavailable.");
      const existingMembership = await transaction.vaultMember.findUnique({
        where: { vaultId_userId: { vaultId: invitation.vaultId, userId: recipient.userId } }
      });
      if (existingMembership) {
        if (existingMembership.role !== "VIEWER" || existingMembership.status === "ACTIVE") {
          throw new SecureShareLinkUnavailableError("Secure Share Link cannot replace the existing membership.");
        }
        await transaction.vaultMember.update({
          where: { vaultId_userId: { vaultId: invitation.vaultId, userId: recipient.userId } },
          data: { status: "ACTIVE", encryptedVaultKey: copyBytes(encryptedVaultKey), keyVersion, revokedAt: null }
        });
      } else {
        await transaction.vaultMember.create({ data: { vaultId: invitation.vaultId, userId: recipient.userId, role: "VIEWER", encryptedVaultKey: copyBytes(encryptedVaultKey), keyVersion } });
      }
      await transaction.vaultInvitation.update({
        where: { id: invitation.id },
        data: { recipientUserId: recipient.userId, status: "REDEEMED", redeemedAt: new Date() }
      });
    });
  }
}

function recipientBindings(recipient: SecureShareLinkRecipient) {
  return [
    { recipientUserId: recipient.userId },
    { recipientUserId: null, recipientEmail: normalizeEmail(recipient.email) }
  ];
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}
