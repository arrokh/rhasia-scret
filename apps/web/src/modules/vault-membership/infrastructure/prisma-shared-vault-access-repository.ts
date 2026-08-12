import { prisma } from "@/shared/infrastructure/prisma-client";
import type { SharedVaultAccess, SharedVaultAccessRepository } from "../application/shared-vault-access-repository";
import { effectiveSharedVaultAccountPermissions } from "@rhasia-scret/client-vault-core";

export class PrismaSharedVaultAccessRepository implements SharedVaultAccessRepository {
  public async listForMember(userId: string): Promise<SharedVaultAccess[]> {
    const memberships = await prisma.vaultMember.findMany({
      where: { userId, status: "ACTIVE", vault: { type: "SHARED", lifecycle: "ACTIVE", deletedAt: null } },
      include: {
        vault: {
          include: {
            accounts: {
              where: { deletedAt: null },
              select: { id: true, encryptedPayload: true, encryptionVersion: true, revision: true }
            }
          }
        }
      },
      orderBy: { createdAt: "asc" }
    });
    return memberships.flatMap((membership) => {
      if (!membership.vault.encryptedName || !membership.encryptedVaultKey || !membership.keyVersion) return [];
      if (membership.role !== "OWNER" && membership.role !== "VIEWER") return [];
      return [{
        vaultId: membership.vaultId,
        role: membership.role,
        effectiveAccountPermissions: effectiveSharedVaultAccountPermissions(
          membership.role,
          {
            canAddAccounts: membership.vault.membersCanAddAccounts,
            canEditAccounts: membership.vault.membersCanEditAccounts,
            canDeleteAccounts: membership.vault.membersCanDeleteAccounts
          },
          {
            canAddAccounts: membership.canAddAccountsOverride,
            canEditAccounts: membership.canEditAccountsOverride,
            canDeleteAccounts: membership.canDeleteAccountsOverride
          }
        ),
        encryptedName: copyBytes(membership.vault.encryptedName),
        encryptionVersion: membership.vault.encryptionVersion,
        encryptedVaultKey: copyBytes(membership.encryptedVaultKey),
        keyVersion: membership.keyVersion,
        accounts: membership.vault.accounts.map((account) => ({ id: account.id, encryptedPayload: copyBytes(account.encryptedPayload), encryptionVersion: account.encryptionVersion, revision: account.revision }))
      }];
    });
  }

  public async getForMember(userId: string, vaultId: string): Promise<SharedVaultAccess | null> {
    const membership = await prisma.vaultMember.findFirst({
      where: { vaultId, userId, status: "ACTIVE", vault: { type: "SHARED", lifecycle: "ACTIVE", deletedAt: null } },
      include: {
        vault: {
          include: {
            accounts: {
              where: { deletedAt: null },
              select: { id: true, encryptedPayload: true, encryptionVersion: true, revision: true }
            }
          }
        }
      }
    });
    if (!membership?.vault.encryptedName || !membership.encryptedVaultKey || !membership.keyVersion) return null;
    if (membership.role !== "OWNER" && membership.role !== "VIEWER") return null;
    return {
      vaultId: membership.vaultId,
      role: membership.role,
      effectiveAccountPermissions: effectiveSharedVaultAccountPermissions(
        membership.role,
        {
          canAddAccounts: membership.vault.membersCanAddAccounts,
          canEditAccounts: membership.vault.membersCanEditAccounts,
          canDeleteAccounts: membership.vault.membersCanDeleteAccounts
        },
        {
          canAddAccounts: membership.canAddAccountsOverride,
          canEditAccounts: membership.canEditAccountsOverride,
          canDeleteAccounts: membership.canDeleteAccountsOverride
        }
      ),
      encryptedName: copyBytes(membership.vault.encryptedName),
      encryptionVersion: membership.vault.encryptionVersion,
      encryptedVaultKey: copyBytes(membership.encryptedVaultKey),
      keyVersion: membership.keyVersion,
      accounts: membership.vault.accounts.map((account) => ({ id: account.id, encryptedPayload: copyBytes(account.encryptedPayload), encryptionVersion: account.encryptionVersion, revision: account.revision }))
    };
  }
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}
