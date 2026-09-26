import { Buffer } from "@api/shared/infrastructure/base64";
import { sha256Digest } from "@api/shared/infrastructure/crypto";
import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";
import { effectiveSharedVaultAccountPermissions } from "@rhasia-scret/client-vault-core/modules/vault-membership/domain/shared-vault-account-permissions";
import { measureServerOperation } from "@api/shared/infrastructure/server-performance";
import type { AuthorizedWorkspaceReader } from "../application/authorized-workspace-reader";
import type { OfflineSyncBundleReader } from "../application/offline-sync-bundle-reader";
import {
  parseAuthorizedWorkspaceResponse,
  parseEncryptedOnlineWorkspaceBundle,
  type AuthorizedWorkspaceResponse,
  type EncryptedOnlineWorkspaceBundle,
  type EncryptedUserEncryptionIdentityProfile,
} from "@rhasia-scret/client-vault-core/modules/sync/domain/offline-vault-bundle";

export class PrismaOfflineSyncBundleReader implements OfflineSyncBundleReader, AuthorizedWorkspaceReader {
  public constructor(private readonly database: PrismaDatabase) {}
  async readAuthorizedBundle(userId: string): Promise<EncryptedOnlineWorkspaceBundle | null> {
    return (await this.readAuthorizedSnapshot(userId))?.bundle ?? null;
  }

  private async readAuthorizedSnapshot(userId: string): Promise<AuthorizedBundleSnapshot | null> {
    return measureServerOperation("rhsia:server:offline-bundle-read", () =>
      this.database.$transaction(
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
          const synchronizationToken = Buffer.from(sha256Digest(JSON.stringify(content))).toString("base64url");
          const bundle = parseEncryptedOnlineWorkspaceBundle({ ...content, synchronizedAt, synchronizationToken });
          const userEncryptionIdentity =
            profile.userEncryptionPublicKey && profile.encryptedUserPrivateKey && profile.userEncryptionKeyVersion === 1
              ? {
                  publicKey: profile.userEncryptionPublicKey as Record<string, unknown>,
                  encryptedPrivateKey: base64(profile.encryptedUserPrivateKey),
                  encryptionVersion: 1 as const,
                }
              : undefined;
          return { bundle, userEncryptionIdentity };
        },
        { isolationLevel: "RepeatableRead" },
      ),
    );
  }

  async readAuthorizedWorkspaceResponse(userId: string): Promise<AuthorizedWorkspaceResponse | null> {
    const snapshot = await this.readAuthorizedSnapshot(userId);
    if (!snapshot) return null;
    const { bundle, userEncryptionIdentity } = snapshot;
    const personalSnapshotContent = {
      schemaVersion: 3 as const,
      profileId: bundle.profileId,
      synchronizedAt: bundle.synchronizedAt,
      cryptoProfile: bundle.cryptoProfile,
      personalVault: bundle.personalVault,
    };
    const synchronizationToken = Buffer.from(sha256Digest(JSON.stringify(personalSnapshotContent))).toString(
      "base64url",
    );
    const workspaceSynchronizationToken = Buffer.from(
      sha256Digest(JSON.stringify({ synchronizationToken: bundle.synchronizationToken, userEncryptionIdentity })),
    ).toString("base64url");
    return parseAuthorizedWorkspaceResponse({
      responseVersion: 1,
      workspaceSynchronizationToken,
      synchronizedAt: bundle.synchronizedAt,
      personalSnapshot: { ...personalSnapshotContent, synchronizationToken },
      sharedVaults: bundle.sharedVaults,
      ...(userEncryptionIdentity ? { userEncryptionIdentity } : {}),
    });
  }
}

type AuthorizedBundleSnapshot = {
  bundle: EncryptedOnlineWorkspaceBundle;
  userEncryptionIdentity?: EncryptedUserEncryptionIdentityProfile;
};

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
