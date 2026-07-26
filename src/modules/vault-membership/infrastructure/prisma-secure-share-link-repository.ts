import { prisma } from "@/shared/infrastructure/prisma-client";
import type { NewSecureShareLink, RedeemableSecureShareLink, SecureShareLinkRepository } from "../application/secure-share-link-repository";

export class PrismaSecureShareLinkRepository implements SecureShareLinkRepository {
  public async create(ownerId: string, vaultId: string, link: NewSecureShareLink): Promise<{ id: string }> {
    const vault = await prisma.vault.findFirst({ where: { id: vaultId, ownerId, type: "SHARED", lifecycle: "ACTIVE", deletedAt: null } });
    if (!vault) throw new Error("Shared Vault is unavailable.");
    const invitation = await prisma.vaultInvitation.create({ data: { vaultId, recipientUserId: link.recipientUserId, linkVerifier: copyBytes(link.linkVerifier), encryptedPackage: copyBytes(link.encryptedPackage) } });
    return { id: invitation.id };
  }

  public async findForRecipient(recipientUserId: string, linkVerifier: Uint8Array): Promise<RedeemableSecureShareLink | null> {
    const invitation = await prisma.vaultInvitation.findFirst({ where: { recipientUserId, linkVerifier: copyBytes(linkVerifier), status: "PENDING" } });
    return invitation ? { id: invitation.id, vaultId: invitation.vaultId, encryptedPackage: copyBytes(invitation.encryptedPackage) } : null;
  }

  public async redeem(recipientUserId: string, invitationId: string, encryptedVaultKey: Uint8Array, keyVersion: number): Promise<void> {
    await prisma.$transaction(async (transaction) => {
      const invitation = await transaction.vaultInvitation.findFirst({ where: { id: invitationId, recipientUserId, status: "PENDING" } });
      if (!invitation) throw new Error("Secure Share Link is unavailable.");
      const existingMembership = await transaction.vaultMember.findUnique({
        where: { vaultId_userId: { vaultId: invitation.vaultId, userId: recipientUserId } }
      });
      if (existingMembership) {
        if (existingMembership.role !== "VIEWER" || existingMembership.status === "ACTIVE") {
          throw new Error("Secure Share Link cannot replace the existing membership.");
        }
        await transaction.vaultMember.update({
          where: { vaultId_userId: { vaultId: invitation.vaultId, userId: recipientUserId } },
          data: { status: "ACTIVE", encryptedVaultKey: copyBytes(encryptedVaultKey), keyVersion, revokedAt: null }
        });
      } else {
        await transaction.vaultMember.create({ data: { vaultId: invitation.vaultId, userId: recipientUserId, role: "VIEWER", encryptedVaultKey: copyBytes(encryptedVaultKey), keyVersion } });
      }
      await transaction.vaultInvitation.update({ where: { id: invitation.id }, data: { status: "REDEEMED", redeemedAt: new Date() } });
    });
  }
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}
