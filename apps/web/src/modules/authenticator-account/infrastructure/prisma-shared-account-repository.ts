import type { Prisma } from "@prisma/client";
import { appendVaultAuditEvent, type AuditAction } from "@/modules/audit/server";
import { prisma } from "@/shared/infrastructure/prisma-client";
import {
  canPerformSharedVaultAccountOperation,
  effectiveSharedVaultAccountPermissions,
  type SharedVaultAccountPermission
} from "@rhasia-scret/client-vault-core";
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
};

export class PrismaSharedAccountRepository implements SharedAccountRepository {
  constructor(private readonly now: () => Date = () => new Date()) {}

  public create(
    actorUserId: string,
    vaultId: string,
    encryptedPayload: Uint8Array,
    encryptionVersion: number
  ): Promise<SharedAccountMutationResult<EncryptedAuthenticatorAccount>> {
    return prisma.$transaction(async (transaction) => {
      const access = await authorize(transaction, actorUserId, vaultId, "ADD");
      if (access.status !== "AUTHORIZED") return access.result;
      const account = await transaction.authenticatorAccount.create({
        data: { vaultId, encryptedPayload: copyBytes(encryptedPayload), encryptionVersion }
      });
      await recordAccountAudit(transaction, access.vault, actorUserId, "ACCOUNT_ADDED", account.id);
      return { status: "SUCCESS", value: encryptedAccount(account) };
    });
  }

  public update(
    actorUserId: string,
    vaultId: string,
    accountId: string,
    expectedRevision: number,
    encryptedPayload: Uint8Array,
    encryptionVersion: number
  ): Promise<SharedAccountMutationResult<EncryptedAuthenticatorAccount>> {
    return prisma.$transaction(async (transaction) => {
      const access = await authorize(transaction, actorUserId, vaultId, "EDIT");
      if (access.status !== "AUTHORIZED") return access.result;
      const updated = await transaction.authenticatorAccount.updateMany({
        where: { id: accountId, vaultId, revision: expectedRevision, deletedAt: null },
        data: { encryptedPayload: copyBytes(encryptedPayload), encryptionVersion, revision: { increment: 1 } }
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
    expectedRevision: number
  ): Promise<SharedAccountMutationResult<undefined>> {
    return prisma.$transaction(async (transaction) => {
      const access = await authorize(transaction, actorUserId, vaultId, "DELETE");
      if (access.status !== "AUTHORIZED") return access.result;
      const deletedAt = this.now();
      const deleted = await transaction.authenticatorAccount.updateMany({
        where: { id: accountId, vaultId, revision: expectedRevision, deletedAt: null },
        data: { deletedAt, purgeAfter: accountPurgeAfter(deletedAt), revision: { increment: 1 } }
      });
      if (deleted.count !== 1) return { status: "STALE_REVISION" };
      await recordAccountAudit(transaction, access.vault, actorUserId, "ACCOUNT_DELETED", accountId);
      return { status: "SUCCESS", value: undefined };
    });
  }

  public restore(
    actorUserId: string,
    vaultId: string,
    accountId: string
  ): Promise<SharedAccountMutationResult<undefined>> {
    return prisma.$transaction(async (transaction) => {
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
          OR: [{ purgeAfter: { gt: now } }, { purgeAfter: null, deletedAt: { gt: legacyRecoveryCutoff } }]
        },
        data: { deletedAt: null, purgeAfter: null, revision: { increment: 1 } }
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
  operation: SharedVaultAccountPermission
): Promise<
  | { status: "AUTHORIZED"; vault: LockedVault }
  | { status: "REJECTED"; result: SharedAccountMutationResult<never> }
> {
  const vault = await lockActiveSharedVault(transaction, vaultId);
  if (!vault) return { status: "REJECTED", result: { status: "VAULT_UNAVAILABLE" } };
  const memberships = await transaction.$queryRaw<LockedMembership[]>`
    SELECT
      "role",
      "can_add_accounts_override" AS "canAddAccountsOverride",
      "can_edit_accounts_override" AS "canEditAccountsOverride",
      "can_delete_accounts_override" AS "canDeleteAccountsOverride"
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
  const effective = effectiveSharedVaultAccountPermissions(
    membership.role,
    {
      canAddAccounts: vault.membersCanAddAccounts,
      canEditAccounts: vault.membersCanEditAccounts,
      canDeleteAccounts: vault.membersCanDeleteAccounts
    },
    {
      canAddAccounts: membership.canAddAccountsOverride,
      canEditAccounts: membership.canEditAccountsOverride,
      canDeleteAccounts: membership.canDeleteAccountsOverride
    }
  );
  if (!canPerformSharedVaultAccountOperation(effective.permissions, operation)) {
    return { status: "REJECTED", result: { status: "PERMISSION_DENIED" } };
  }
  return { status: "AUTHORIZED", vault };
}

async function lockActiveSharedVault(transaction: Prisma.TransactionClient, vaultId: string): Promise<LockedVault | null> {
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
  accountId: string
) {
  return appendVaultAuditEvent(transaction, { vaultId: vault.id, ownerId: vault.ownerId, actorUserId, action, targetId: accountId });
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
    account.revision
  );
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}
