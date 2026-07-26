import { prisma } from "@/shared/infrastructure/prisma-client";
import type { VaultParticipant, VaultParticipantRepository } from "../application/vault-participant-repository";

export class PrismaVaultParticipantRepository implements VaultParticipantRepository {
  public async listForOwner(ownerId: string, vaultId: string): Promise<VaultParticipant[] | null> {
    const vault = await prisma.vault.findFirst({
      where: { id: vaultId, ownerId, type: "SHARED", lifecycle: "ACTIVE", deletedAt: null },
      select: {
        owner: { select: { id: true, email: true } },
        members: {
          where: { role: "VIEWER", status: "ACTIVE" },
          select: { userId: true, createdAt: true, user: { select: { email: true } } },
          orderBy: { createdAt: "asc" }
        },
        invitations: {
          where: { status: "PENDING" },
          select: { id: true, recipientEmail: true, recipientUserId: true, createdAt: true, recipient: { select: { email: true } } },
          orderBy: { createdAt: "asc" }
        }
      }
    });
    if (!vault) return null;
    return [
      { key: `owner:${vault.owner.id}`, email: vault.owner.email, kind: "OWNER", userId: vault.owner.id, invitationId: null, invitedAt: null },
      ...vault.members.map((member) => ({ key: `member:${member.userId}`, email: member.user.email, kind: "MEMBER" as const, userId: member.userId, invitationId: null, invitedAt: member.createdAt })),
      ...vault.invitations.flatMap((invitation) => {
        const email = invitation.recipientEmail ?? invitation.recipient?.email;
        return email ? [{ key: `invitation:${invitation.id}`, email, kind: "INVITATION" as const, userId: invitation.recipientUserId, invitationId: invitation.id, invitedAt: invitation.createdAt }] : [];
      })
    ];
  }

  public async cancelInvitation(ownerId: string, vaultId: string, invitationId: string): Promise<boolean> {
    const deleted = await prisma.vaultInvitation.deleteMany({
      where: {
        id: invitationId,
        vaultId,
        status: "PENDING",
        vault: { ownerId, type: "SHARED", lifecycle: "ACTIVE", deletedAt: null }
      }
    });
    return deleted.count === 1;
  }
}
