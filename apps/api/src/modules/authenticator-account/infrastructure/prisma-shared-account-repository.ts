import type { Prisma } from "@prisma/client";
import { appendVaultAuditEvent, type AuditAction } from "@api/modules/audit/server";
import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";
import { sha256Digest, toBase64Url } from "@api/shared/infrastructure/crypto";
import type {
  EncryptedPayloadMigration,
  EncryptedPayloadMigrationResult,
} from "@api/shared/application/encrypted-payload-migration";
import {
  canPerformSharedVaultAccountOperation,
  effectiveSharedVaultAccountPermissions,
  type SharedVaultAccountPermission,
} from "@rhasia-scret/client-vault-core/modules/vault-membership/domain/shared-vault-account-permissions";
import type { SharedAccountMutationResult, SharedAccountRepository } from "../application/shared-account-repository";
import { EncryptedAuthenticatorAccount } from "../domain/encrypted-account";
import { ACCOUNT_RECOVERY_DAYS, accountPurgeAfter } from "../domain/account-retention-policy";

type LockedVault = {
  id: string;
  ownerId: string;
  membersCanAddAccounts: boolean;
  membersCanEditAccounts: boolean;
  membersCanDeleteAccounts: boolean;
};

type LockedMembership = {
  role: string;
  canAddAccountsOverride: boolean | null;
  canEditAccountsOverride: boolean | null;
  canDeleteAccountsOverride: boolean | null;
  keyVersion: number;
};

export class PrismaSharedAccountRepository implements SharedAccountRepository {
  constructor(
    private readonly database: PrismaDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public create(
    actorUserId: string,
    vaultId: string,
    encryptedPayload: Uint8Array,
    encryptionVersion: number,
    expectedKeyVersion: number,
  ): Promise<SharedAccountMutationResult<EncryptedAuthenticatorAccount>> {
    return this.database.$transaction(async (transaction) => {
      const access = await authorize(transaction, actorUserId, vaultId, "ADD", expectedKeyVersion);
      if (access.status !== "AUTHORIZED") return access.result;
      const account = await transaction.authenticatorAccount.create({
        data: { vaultId, encryptedPayload: copyBytes(encryptedPayload), encryptionVersion },
      });
      await recordAccountAudit(transaction, access.vault, actorUserId, "ACCOUNT_ADDED", account.id);
      return { status: "SUCCESS", value: encryptedAccount(account) };
    });
  }

  public async migratePayload(
    actorUserId: string,
    vaultId: string,
    accountId: string,
    expectedRevision: number,
    expectedKeyVersion: number,
    migration: EncryptedPayloadMigration,
  ): Promise<EncryptedPayloadMigrationResult> {
    const replacement = copyBytes(migration.replacementCiphertext);
    try {
      if (!validAccountMigration(migration, replacement)) return "conflict";
      return await this.database.$transaction(async (transaction) => {
        const access = await authorize(transaction, actorUserId, vaultId, "MIGRATE", expectedKeyVersion);
        if (access.status !== "AUTHORIZED") return "conflict";
        const account = await transaction.authenticatorAccount.findUnique({
          where: { id: accountId },
          select: { vaultId: true, encryptedPayload: true, encryptionVersion: true, revision: true, deletedAt: true },
        });
        if (!account || account.vaultId !== vaultId || account.deletedAt || account.encryptionVersion !== 1)
          return "conflict";
        const current = copyBytes(account.encryptedPayload);
        try {
          const currentDigest = digestString(current);
          if (currentDigest === migration.replacementCiphertextDigest) return "already-committed";
          if (
            account.revision !== expectedRevision ||
            current[0] !== migration.expectedEnvelopeVersion ||
            currentDigest !== migration.expectedCiphertextDigest
          )
            return "conflict";
          const updated = await transaction.authenticatorAccount.updateMany({
            where: { id: accountId, vaultId, revision: expectedRevision, deletedAt: null, encryptedPayload: current },
            data: { encryptedPayload: replacement },
          });
          return updated.count === 1 ? "committed" : "conflict";
        } finally {
          current.fill(0);
        }
      });
    } finally {
      replacement.fill(0);
    }
  }

  public update(
    actorUserId: string,
    vaultId: string,
    accountId: string,
    expectedRevision: number,
    encryptedPayload: Uint8Array,
    encryptionVersion: number,
    expectedKeyVersion: number,
  ): Promise<SharedAccountMutationResult<EncryptedAuthenticatorAccount>> {
    return this.database.$transaction(async (transaction) => {
      const access = await authorize(transaction, actorUserId, vaultId, "EDIT", expectedKeyVersion);
      if (access.status !== "AUTHORIZED") return access.result;
      const updated = await transaction.authenticatorAccount.updateMany({
        where: { id: accountId, vaultId, revision: expectedRevision, deletedAt: null },
        data: { encryptedPayload: copyBytes(encryptedPayload), encryptionVersion, revision: { increment: 1 } },
      });
      if (updated.count !== 1) return { status: "STALE_REVISION" };
      const account = await transaction.authenticatorAccount.findUniqueOrThrow({ where: { id: accountId } });
      await recordAccountAudit(transaction, access.vault, actorUserId, "ACCOUNT_UPDATED", accountId);
      return { status: "SUCCESS", value: encryptedAccount(account) };
    });
  }

  public delete(
    actorUserId: string,
    vaultId: string,
    accountId: string,
    expectedRevision: number,
  ): Promise<SharedAccountMutationResult<undefined>> {
    return this.database.$transaction(async (transaction) => {
      const access = await authorize(transaction, actorUserId, vaultId, "DELETE");
      if (access.status !== "AUTHORIZED") return access.result;
      const deletedAt = this.now();
      const deleted = await transaction.authenticatorAccount.updateMany({
        where: { id: accountId, vaultId, revision: expectedRevision, deletedAt: null },
        data: { deletedAt, purgeAfter: accountPurgeAfter(deletedAt), revision: { increment: 1 } },
      });
      if (deleted.count !== 1) return { status: "STALE_REVISION" };
      await recordAccountAudit(transaction, access.vault, actorUserId, "ACCOUNT_DELETED", accountId);
      return { status: "SUCCESS", value: undefined };
    });
  }

  public restore(
    actorUserId: string,
    vaultId: string,
    accountId: string,
  ): Promise<SharedAccountMutationResult<undefined>> {
    return this.database.$transaction(async (transaction) => {
      const vault = await lockActiveSharedVault(transaction, vaultId);
      if (!vault) return { status: "VAULT_UNAVAILABLE" };
      if (vault.ownerId !== actorUserId) return { status: "PERMISSION_DENIED" };
      const now = this.now();
      const legacyRecoveryCutoff = new Date(now.getTime() - ACCOUNT_RECOVERY_DAYS * 24 * 60 * 60 * 1000);
      const restored = await transaction.authenticatorAccount.updateMany({
        where: {
          id: accountId,
          vaultId,
          deletedAt: { not: null },
          OR: [{ purgeAfter: { gt: now } }, { purgeAfter: null, deletedAt: { gt: legacyRecoveryCutoff } }],
        },
        data: { deletedAt: null, purgeAfter: null, revision: { increment: 1 } },
      });
      if (restored.count !== 1) return { status: "ACCOUNT_UNAVAILABLE" };
      await recordAccountAudit(transaction, vault, actorUserId, "ACCOUNT_RESTORED", accountId);
      return { status: "SUCCESS", value: undefined };
    });
  }
}

async function authorize(
  transaction: Prisma.TransactionClient,
  actorUserId: string,
  vaultId: string,
  operation: SharedVaultAccountPermission | "MIGRATE",
  expectedKeyVersion?: number,
): Promise<
  { status: "AUTHORIZED"; vault: LockedVault } | { status: "REJECTED"; result: SharedAccountMutationResult<never> }
> {
  const vault = await lockActiveSharedVault(transaction, vaultId);
  if (!vault) return { status: "REJECTED", result: { status: "VAULT_UNAVAILABLE" } };
  const memberships = await transaction.$queryRaw<LockedMembership[]>`
    SELECT
      "role",
      "can_add_accounts_override" AS "canAddAccountsOverride",
      "can_edit_accounts_override" AS "canEditAccountsOverride",
      "can_delete_accounts_override" AS "canDeleteAccountsOverride",
      "key_version" AS "keyVersion"
    FROM "vault_members"
    WHERE "vault_id" = ${vaultId}
      AND "user_id" = ${actorUserId}
      AND "status" = 'ACTIVE'
    FOR UPDATE
  `;
  const membership = memberships[0];
  if (!membership || (membership.role !== "OWNER" && membership.role !== "VIEWER")) {
    return { status: "REJECTED", result: { status: "VAULT_UNAVAILABLE" } };
  }
  if (expectedKeyVersion !== undefined && membership.keyVersion !== expectedKeyVersion) {
    return { status: "REJECTED", result: { status: "STALE_KEY_VERSION" } };
  }
  const effective = effectiveSharedVaultAccountPermissions(
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
  );
  if (operation !== "MIGRATE" && !canPerformSharedVaultAccountOperation(effective.permissions, operation)) {
    return { status: "REJECTED", result: { status: "PERMISSION_DENIED" } };
  }
  return { status: "AUTHORIZED", vault };
}

async function lockActiveSharedVault(
  transaction: Prisma.TransactionClient,
  vaultId: string,
): Promise<LockedVault | null> {
  const vaults = await transaction.$queryRaw<LockedVault[]>`
    SELECT
      "id",
      "owner_id" AS "ownerId",
      "members_can_add_accounts" AS "membersCanAddAccounts",
      "members_can_edit_accounts" AS "membersCanEditAccounts",
      "members_can_delete_accounts" AS "membersCanDeleteAccounts"
    FROM "vaults"
    WHERE "id" = ${vaultId}
      AND "type" = 'SHARED'
      AND "lifecycle" = 'ACTIVE'
      AND "deleted_at" IS NULL
    FOR UPDATE
  `;
  return vaults[0] ?? null;
}

function recordAccountAudit(
  transaction: Prisma.TransactionClient,
  vault: LockedVault,
  actorUserId: string,
  action: Extract<AuditAction, "ACCOUNT_ADDED" | "ACCOUNT_UPDATED" | "ACCOUNT_DELETED" | "ACCOUNT_RESTORED">,
  accountId: string,
) {
  return appendVaultAuditEvent(transaction, {
    vaultId: vault.id,
    ownerId: vault.ownerId,
    actorUserId,
    action,
    targetId: accountId,
  });
}

function encryptedAccount(account: {
  id: string;
  vaultId: string;
  encryptedPayload: Uint8Array;
  encryptionVersion: number;
  revision: number;
}): EncryptedAuthenticatorAccount {
  return new EncryptedAuthenticatorAccount(
    account.id,
    account.vaultId,
    account.encryptedPayload,
    account.encryptionVersion,
    account.revision,
  );
}

function validAccountMigration(migration: EncryptedPayloadMigration, replacement: Uint8Array): boolean {
  return (
    migration.expectedEnvelopeVersion === 1 &&
    migration.replacementEnvelopeVersion === 2 &&
    migration.expectedCiphertextDigest.length === 43 &&
    migration.replacementCiphertextDigest.length === 43 &&
    migration.operationId === migration.replacementCiphertextDigest &&
    replacement.length >= 29 &&
    replacement[0] === 2 &&
    digestString(replacement) === migration.replacementCiphertextDigest
  );
}

function digestString(bytes: Uint8Array): string {
  const digest = sha256Digest(bytes);
  try {
    return toBase64Url(digest);
  } finally {
    digest.fill(0);
  }
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}
