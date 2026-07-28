import { prisma } from "@/shared/infrastructure/prisma-client";
import type {
  PermissionUpdateResult,
  SharedVaultAccountPermissionRepository,
  VaultMemberPermissionDefaults,
  VaultMemberPermissionState
} from "../application/manage-shared-vault-account-permissions";
import {
  effectiveSharedVaultAccountPermissions,
  type SharedVaultAccountPermissionOverrides,
  type SharedVaultAccountPermissions
} from "../domain/shared-vault-account-permissions";

export class PrismaSharedVaultAccountPermissionRepository implements SharedVaultAccountPermissionRepository {
  public updateVaultDefaults(
    ownerId: string,
    vaultId: string,
    expectedRevision: number,
    permissions: SharedVaultAccountPermissions
  ): Promise<PermissionUpdateResult<VaultMemberPermissionDefaults>> {
    return prisma.$transaction(async (transaction) => {
      const updated = await transaction.vault.updateMany({
        where: {
          id: vaultId,
          ownerId,
          type: "SHARED",
          lifecycle: "ACTIVE",
          deletedAt: null,
          memberPermissionsRevision: expectedRevision
        },
        data: {
          membersCanAddAccounts: permissions.canAddAccounts,
          membersCanEditAccounts: permissions.canEditAccounts,
          membersCanDeleteAccounts: permissions.canDeleteAccounts,
          memberPermissionsRevision: { increment: 1 }
        }
      });
      if (updated.count !== 1) {
        const available = await transaction.vault.findFirst({
          where: { id: vaultId, ownerId, type: "SHARED", lifecycle: "ACTIVE", deletedAt: null },
          select: { id: true }
        });
        return { status: available ? "STALE" : "UNAVAILABLE" };
      }

      const vault = await transaction.vault.findUniqueOrThrow({
        where: { id: vaultId },
        select: {
          membersCanAddAccounts: true,
          membersCanEditAccounts: true,
          membersCanDeleteAccounts: true,
          memberPermissionsRevision: true
        }
      });
      await transaction.vaultAuditEvent.create({
        data: {
          vaultId,
          ownerId,
          actorUserId: ownerId,
          eventType: "VAULT_MEMBER_DEFAULT_PERMISSIONS_UPDATED"
        }
      });
      return {
        status: "UPDATED",
        value: {
          permissions: vaultPermissions(vault),
          revision: vault.memberPermissionsRevision
        }
      };
    });
  }

  public updateMemberOverrides(
    ownerId: string,
    vaultId: string,
    memberUserId: string,
    expectedRevision: number,
    overrides: SharedVaultAccountPermissionOverrides
  ): Promise<PermissionUpdateResult<VaultMemberPermissionState>> {
    return prisma.$transaction(async (transaction) => {
      const updated = await transaction.vaultMember.updateMany({
        where: {
          vaultId,
          userId: memberUserId,
          role: "VIEWER",
          status: "ACTIVE",
          permissionsRevision: expectedRevision,
          vault: { ownerId, type: "SHARED", lifecycle: "ACTIVE", deletedAt: null }
        },
        data: {
          canAddAccountsOverride: overrides.canAddAccounts,
          canEditAccountsOverride: overrides.canEditAccounts,
          canDeleteAccountsOverride: overrides.canDeleteAccounts,
          permissionsRevision: { increment: 1 }
        }
      });
      if (updated.count !== 1) {
        const available = await transaction.vaultMember.findFirst({
          where: {
            vaultId,
            userId: memberUserId,
            role: "VIEWER",
            status: "ACTIVE",
            vault: { ownerId, type: "SHARED", lifecycle: "ACTIVE", deletedAt: null }
          },
          select: { userId: true }
        });
        return { status: available ? "STALE" : "UNAVAILABLE" };
      }

      const member = await transaction.vaultMember.findUniqueOrThrow({
        where: { vaultId_userId: { vaultId, userId: memberUserId } },
        select: {
          role: true,
          canAddAccountsOverride: true,
          canEditAccountsOverride: true,
          canDeleteAccountsOverride: true,
          permissionsRevision: true,
          vault: {
            select: {
              membersCanAddAccounts: true,
              membersCanEditAccounts: true,
              membersCanDeleteAccounts: true
            }
          }
        }
      });
      const storedOverrides = memberOverrides(member);
      await transaction.vaultAuditEvent.create({
        data: {
          vaultId,
          ownerId,
          actorUserId: ownerId,
          eventType: "MEMBER_PERMISSIONS_UPDATED",
          targetId: memberUserId
        }
      });
      return {
        status: "UPDATED",
        value: {
          overrides: storedOverrides,
          effective: effectiveSharedVaultAccountPermissions("VIEWER", vaultPermissions(member.vault), storedOverrides),
          revision: member.permissionsRevision
        }
      };
    });
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

function memberOverrides(value: {
  canAddAccountsOverride: boolean | null;
  canEditAccountsOverride: boolean | null;
  canDeleteAccountsOverride: boolean | null;
}): SharedVaultAccountPermissionOverrides {
  return {
    canAddAccounts: value.canAddAccountsOverride,
    canEditAccounts: value.canEditAccountsOverride,
    canDeleteAccounts: value.canDeleteAccountsOverride
  };
}
