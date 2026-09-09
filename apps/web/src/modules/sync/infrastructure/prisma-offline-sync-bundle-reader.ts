import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { prisma } from "@/shared/infrastructure/prisma-client";
import { effectiveSharedVaultAccountPermissions } from "@rhasia-scret/client-vault-core";
import { measureServerOperation } from "@/shared/infrastructure/server-performance";
import type { OfflineSyncBundleReader } from "../application/offline-sync-bundle-reader";
import { parseEncryptedOfflineVaultBundle, type EncryptedOfflineVaultBundle } from "@rhasia-scret/client-vault-core";

export class PrismaOfflineSyncBundleReader implements OfflineSyncBundleReader {
  async readAuthorizedBundle(userId: string): Promise<EncryptedOfflineVaultBundle | null> {
    return measureServerOperation("rhsia:server:offline-bundle-read", () =>
      prisma.$transaction(
        async (transaction) => {
          const [profile, personalVault, memberships] = await Promise.all([
            transaction.userCryptoProfile.findUnique({ where: { userId } }),
            transaction.vault.findFirst({
              where: { ownerId: userId, type: "PERSONAL", lifecycle: "ACTIVE", deletedAt: null },
              include: { accounts: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } } },
              orderBy: { createdAt: "asc" },
            }),
            transaction.vaultMember.findMany({
              where: { userId, status: "ACTIVE", vault: { type: "SHARED", lifecycle: "ACTIVE", deletedAt: null } },
              include: {
                vault: { include: { accounts: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } } } },
              },
              orderBy: { createdAt: "asc" },
            }),
          ]);
          if (!profile || !personalVault?.encryptedName) return null;

          const synchronizedAt = new Date().toISOString();
          const content = {
            schemaVersion: 2 as const,
            profileId: userId,
            cryptoProfile: {
              vaultUnlockSalt: base64(profile.vaultUnlockSalt),
              wrappedUserRootKey: base64(profile.wrappedUserRootKey),
              encryptedPersonalVaultKey: base64(profile.encryptedPersonalVaultKey),
              encryptionVersion: profile.rootKeyWrappingVersion,
            },
            personalVault: {
              vaultId: personalVault.id,
              lifecycle: "ACTIVE",
              encryptedName: base64(personalVault.encryptedName),
              encryptionVersion: personalVault.encryptionVersion,
              accounts: personalVault.accounts.map(accountRecord),
            },
            sharedVaults: memberships.flatMap((membership) => {
              const vault = membership.vault;
              if (!vault.encryptedName || !membership.encryptedVaultKey || !membership.keyVersion) return [];
              if (membership.role !== "OWNER" && membership.role !== "VIEWER") return [];
              return [
                {
                  vaultId: vault.id,
                  lifecycle: "ACTIVE" as const,
                  role: membership.role,
                  effectiveAccountPermissions: effectiveSharedVaultAccountPermissions(
                    membership.role,
                    {
                      canAddAccounts: vault.membersCanAddAccounts,
                      canEditAccounts: vault.membersCanEditAccounts,
                      canDeleteAccounts: vault.membersCanDeleteAccounts,
                    },
                    {
                      canAddAccounts: membership.canAddAccountsOverride,
                      canEditAccounts: membership.canEditAccountsOverride,
                      canDeleteAccounts: membership.canDeleteAccountsOverride,
                    },
                  ),
                  encryptedName: base64(vault.encryptedName),
                  encryptionVersion: vault.encryptionVersion,
                  encryptedVaultKey: base64(membership.encryptedVaultKey),
                  keyVersion: membership.keyVersion,
                  accounts: vault.accounts.map(accountRecord),
                },
              ];
            }),
          };
          const synchronizationToken = createHash("sha256").update(JSON.stringify(content)).digest("base64url");
          return parseEncryptedOfflineVaultBundle({ ...content, synchronizedAt, synchronizationToken });
        },
        { isolationLevel: "RepeatableRead" },
      ),
    );
  }
}

function accountRecord(account: {
  id: string;
  encryptedPayload: Uint8Array;
  encryptionVersion: number;
  revision: number;
}) {
  return {
    id: account.id,
    encryptedPayload: base64(account.encryptedPayload),
    encryptionVersion: account.encryptionVersion,
    revision: account.revision,
  };
}

function base64(value: Uint8Array): string {
  return Buffer.from(value).toString("base64");
}
