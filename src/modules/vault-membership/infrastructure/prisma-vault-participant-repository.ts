import { buildCursorPage, type CursorPageRequest } from "@/shared/application/cursor-page";
import { timestampKeysetWhere } from "@/shared/infrastructure/prisma-cursor-pagination";
import { prisma } from "@/shared/infrastructure/prisma-client";
import { parseVaultParticipantCursorKey, type VaultParticipant, type VaultParticipantPage, type VaultParticipantRepository } from "../application/vault-participant-repository";
import { invitationIsExpired } from "../domain/invitation-expiry";
import { effectiveSharedVaultAccountPermissions, type SharedVaultAccountPermissions } from "../domain/shared-vault-account-permissions";

const memberKey = (userId: string) => `member:${userId}`;
const invitationKey = (id: string) => `invitation:${id}`;

export class PrismaVaultParticipantRepository implements VaultParticipantRepository {
  public constructor(private readonly now: () => Date = () => new Date()) {}

  public async listForOwner(ownerId: string, vaultId: string, request: CursorPageRequest): Promise<VaultParticipantPage | null> {
    const vault = await prisma.vault.findFirst({
      where: { id: vaultId, ownerId, type: "SHARED", lifecycle: "ACTIVE", deletedAt: null },
      select: {
        owner: { select: { id: true, email: true } },
        membersCanAddAccounts: true,
        membersCanEditAccounts: true,
        membersCanDeleteAccounts: true,
        memberPermissionsRevision: true
      }
    });
    if (!vault) return null;
    const defaults = vaultPermissions(vault);
    const now = this.now();

    const participants: VaultParticipant[] = [];
    const cursorKey = request.cursor ? parseVaultParticipantCursorKey(request.cursor.key) : null;
    if (request.cursor && !cursorKey) return {
      owner: vault.owner,
      vaultDefaultAccountPermissions: defaults,
      vaultDefaultAccountPermissionsRevision: vault.memberPermissionsRevision,
      items: [],
      nextCursor: null
    };

    if (cursorKey?.kind !== "INVITATION") {
      const cursorUserId = cursorKey?.kind === "MEMBER" ? cursorKey.id : null;
      const members = await prisma.vaultMember.findMany({
        where: {
          vaultId,
          role: "VIEWER",
          status: "ACTIVE",
          vault: { ownerId, type: "SHARED", lifecycle: "ACTIVE", deletedAt: null },
          ...(request.cursor && cursorUserId ? timestampKeysetWhere({ createdAt: request.cursor.createdAt, key: cursorUserId }, "userId", "ascending") : {})
        },
        select: {
          userId: true,
          createdAt: true,
          canAddAccountsOverride: true,
          canEditAccountsOverride: true,
          canDeleteAccountsOverride: true,
          permissionsRevision: true,
          user: { select: { email: true } }
        },
        orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
        take: request.limit + 1
      });
      participants.push(...members.map((member) => {
        const permissionOverrides = {
          canAddAccounts: member.canAddAccountsOverride,
          canEditAccounts: member.canEditAccountsOverride,
          canDeleteAccounts: member.canDeleteAccountsOverride
        };
        return {
          key: memberKey(member.userId),
          email: member.user.email,
          kind: "MEMBER" as const,
          userId: member.userId,
          invitationId: null,
          invitationState: null,
          invitedAt: member.createdAt,
          expiresAt: null,
          permissionOverrides,
          effectiveAccountPermissions: effectiveSharedVaultAccountPermissions("VIEWER", defaults, permissionOverrides),
          permissionsRevision: member.permissionsRevision
        };
      }));
    }

    if (participants.length <= request.limit) {
      const remaining = request.limit + 1 - participants.length;
      const cursorInvitationId = cursorKey?.kind === "INVITATION" ? cursorKey.id : null;
      const invitations = await prisma.vaultInvitation.findMany({
        where: {
          vaultId,
          status: "PENDING",
          vault: { ownerId, type: "SHARED", lifecycle: "ACTIVE", deletedAt: null },
          AND: [
            { OR: [{ recipientEmail: { not: null } }, { recipientUserId: { not: null } }] },
            ...(request.cursor && cursorInvitationId ? [timestampKeysetWhere({ createdAt: request.cursor.createdAt, key: cursorInvitationId }, "id", "ascending")] : [])
          ]
        },
        select: { id: true, recipientEmail: true, recipientUserId: true, createdAt: true, expiresAt: true, recipient: { select: { email: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: remaining
      });
      participants.push(...invitations.flatMap((invitation) => {
        const email = invitation.recipientEmail ?? invitation.recipient?.email;
        return email ? [{
          key: invitationKey(invitation.id),
          email,
          kind: "INVITATION" as const,
          userId: invitation.recipientUserId,
          invitationId: invitation.id,
          invitationState: invitationIsExpired(invitation.expiresAt, now) ? "EXPIRED" as const : "PENDING" as const,
          invitedAt: invitation.createdAt,
          expiresAt: invitation.expiresAt,
          permissionOverrides: null,
          effectiveAccountPermissions: null,
          permissionsRevision: null
        }] : [];
      }));
    }

    const page = buildCursorPage(participants, request.limit, (participant) => ({ createdAt: participant.invitedAt, key: participant.key }));
    return {
      owner: vault.owner,
      vaultDefaultAccountPermissions: defaults,
      vaultDefaultAccountPermissionsRevision: vault.memberPermissionsRevision,
      ...page
    };
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

function vaultPermissions(value: {
  membersCanAddAccounts: boolean;
  membersCanEditAccounts: boolean;
  membersCanDeleteAccounts: boolean;
}): SharedVaultAccountPermissions {
  return {
    canAddAccounts: value.membersCanAddAccounts,
    canEditAccounts: value.membersCanEditAccounts,
    canDeleteAccounts: value.membersCanDeleteAccounts
  };
}
