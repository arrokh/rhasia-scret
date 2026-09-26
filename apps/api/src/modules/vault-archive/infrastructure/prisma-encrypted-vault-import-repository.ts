import { Prisma } from "@prisma/client";
import { appendVaultAuditEvent } from "@api/modules/audit/server";
import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";
import { publicEncryptionKeySchema } from "@api/http/public-encryption-key";
import { effectiveSharedVaultAccountPermissions } from "@rhasia-scret/client-vault-core/modules/vault-membership/domain/shared-vault-account-permissions";
import type { EncryptedVaultImportRepository } from "../application/import-encrypted-vault-archive";
import {
  hasDuplicateImportedAccountIds,
  type EncryptedVaultImport,
  type EncryptedVaultImportResult,
} from "../domain/encrypted-vault-import";

type LockedDestination = {
  id: string;
  type: string;
  ownerId: string;
  membersCanAddAccounts: boolean;
  membersCanEditAccounts: boolean;
  membersCanDeleteAccounts: boolean;
  keyVersion: number | null;
};

type ImportMembership = {
  role: string;
  canAddAccountsOverride: boolean | null;
  canEditAccountsOverride: boolean | null;
  canDeleteAccountsOverride: boolean | null;
  keyVersion: number;
};

export class PrismaEncryptedVaultImportRepository implements EncryptedVaultImportRepository {
  public constructor(private readonly database: PrismaDatabase) {}
  public async import(actorUserId: string, request: EncryptedVaultImport): Promise<EncryptedVaultImportResult> {
    if (hasDuplicateImportedAccountIds(request.accounts)) return { status: "CONFLICT" };
    try {
      return await this.database.$transaction(async (transaction) => {
        if (request.destination.kind === "NEW_SHARED")
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actorUserId}))`;
        const destination = await lockAuthorizedDestination(transaction, actorUserId, request);
        if (request.destination.kind === "EXISTING" && !destination) return { status: "DESTINATION_UNAVAILABLE" };
        if (request.destination.kind === "NEW_SHARED" && destination) {
          return replayResult(transaction, request, true);
        }

        const existingAccounts = request.accounts.length
          ? await transaction.authenticatorAccount.findMany({
              where: { id: { in: request.accounts.map(({ id }) => id) } },
              select: { id: true, vaultId: true },
            })
          : [];
        if (existingAccounts.length > 0) {
          if (
            existingAccounts.length === request.accounts.length &&
            existingAccounts.every(({ vaultId }) => vaultId === request.destination.vaultId)
          ) {
            return {
              status: "REPLAYED",
              vaultId: request.destination.vaultId,
              accountIds: request.accounts.map(({ id }) => id),
              vaultCreated: request.destination.kind === "NEW_SHARED",
            };
          }
          return { status: "CONFLICT" };
        }

        if (
          request.destination.kind === "EXISTING" &&
          request.destination.vaultType === "SHARED" &&
          destination?.keyVersion !== request.destination.expectedKeyVersion
        )
          return { status: "CONFLICT" };

        if (request.destination.kind === "NEW_SHARED") {
          const profile = await transaction.userCryptoProfile.findUnique({
            where: { userId: actorUserId },
            select: { userEncryptionPublicKey: true },
          });
          if (!profile || !samePublicKey(profile.userEncryptionPublicKey, request.destination.expectedOwnerPublicKey))
            return { status: "CONFLICT" };
          await transaction.vault.create({
            data: {
              id: request.destination.vaultId,
              ownerId: actorUserId,
              type: "SHARED",
              lifecycle: "ACTIVE",
              encryptedName: copyBytes(request.destination.encryptedName),
              encryptionVersion: request.destination.encryptionVersion,
              members: {
                create: {
                  userId: actorUserId,
                  role: "OWNER",
                  encryptedVaultKey: copyBytes(request.destination.encryptedOwnerVaultKey),
                  keyVersion: 1,
                },
              },
              accounts: {
                create: request.accounts.map((account) => ({
                  id: account.id,
                  encryptedPayload: copyBytes(account.encryptedPayload),
                  encryptionVersion: account.encryptionVersion,
                })),
              },
            },
          });
          await appendVaultAuditEvent(transaction, {
            vaultId: request.destination.vaultId,
            ownerId: actorUserId,
            actorUserId,
            action: "ARCHIVE_IMPORTED",
          });
        } else {
          if (!destination) return { status: "DESTINATION_UNAVAILABLE" };
          if (request.accounts.length) {
            await transaction.authenticatorAccount.createMany({
              data: request.accounts.map((account) => ({
                id: account.id,
                vaultId: request.destination.vaultId,
                encryptedPayload: copyBytes(account.encryptedPayload),
                encryptionVersion: account.encryptionVersion,
              })),
            });
          }
          await appendVaultAuditEvent(transaction, {
            vaultId: request.destination.vaultId,
            ownerId: destination.ownerId,
            actorUserId,
            action: "ARCHIVE_IMPORTED",
          });
        }
        return {
          status: "IMPORTED",
          vaultId: request.destination.vaultId,
          accountIds: request.accounts.map(({ id }) => id),
          vaultCreated: request.destination.kind === "NEW_SHARED",
        };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const replay = await this.readReplay(actorUserId, request);
        return replay ?? { status: "CONFLICT" };
      }
      throw error;
    }
  }

  private async readReplay(
    actorUserId: string,
    request: EncryptedVaultImport,
  ): Promise<EncryptedVaultImportResult | null> {
    const authorized = await isCurrentlyAuthorized(this.database, actorUserId, request);
    if (!authorized) return null;
    const accounts = request.accounts.length
      ? await this.database.authenticatorAccount.findMany({
          where: { id: { in: request.accounts.map(({ id }) => id) }, vaultId: request.destination.vaultId },
          select: { id: true },
        })
      : [];
    if (accounts.length !== request.accounts.length) return null;
    return {
      status: "REPLAYED",
      vaultId: request.destination.vaultId,
      accountIds: request.accounts.map(({ id }) => id),
      vaultCreated: request.destination.kind === "NEW_SHARED",
    };
  }
}

async function lockAuthorizedDestination(
  transaction: Prisma.TransactionClient,
  actorUserId: string,
  request: EncryptedVaultImport,
): Promise<LockedDestination | undefined> {
  const expectedType = request.destination.kind === "NEW_SHARED" ? "SHARED" : request.destination.vaultType;
  const rows = await transaction.$queryRaw<LockedDestination[]>`
    SELECT
      "id",
      "type",
      "owner_id" AS "ownerId",
      "members_can_add_accounts" AS "membersCanAddAccounts",
      "members_can_edit_accounts" AS "membersCanEditAccounts",
      "members_can_delete_accounts" AS "membersCanDeleteAccounts",
      NULL::integer AS "keyVersion"
    FROM "vaults"
    WHERE "id" = ${request.destination.vaultId}
      AND "type" = ${expectedType}
      AND "lifecycle" = 'ACTIVE'
      AND "deleted_at" IS NULL
    FOR UPDATE
  `;
  const destination = rows[0];
  if (!destination) return undefined;
  if (destination.type === "PERSONAL") return destination.ownerId === actorUserId ? destination : undefined;
  const isOwner = destination.ownerId === actorUserId;
  if (!isOwner && request.destination.kind !== "EXISTING") return undefined;
  if (request.destination.kind === "EXISTING" && request.destination.vaultType !== "SHARED") return undefined;

  const memberships = await transaction.$queryRaw<ImportMembership[]>`
    SELECT
      "role",
      "can_add_accounts_override" AS "canAddAccountsOverride",
      "can_edit_accounts_override" AS "canEditAccountsOverride",
      "can_delete_accounts_override" AS "canDeleteAccountsOverride",
      "key_version" AS "keyVersion"
    FROM "vault_members"
    WHERE "vault_id" = ${destination.id}
      AND "user_id" = ${actorUserId}
      AND "status" = 'ACTIVE'
    FOR UPDATE
  `;
  const membership = memberships[0];
  if (!membership) return undefined;
  const authorizedDestination = { ...destination, keyVersion: membership.keyVersion };
  if (isOwner) return membership.role === "OWNER" ? authorizedDestination : undefined;
  if (membership.role !== "VIEWER") return undefined;
  const effective = effectiveSharedVaultAccountPermissions(
    "VIEWER",
    {
      canAddAccounts: destination.membersCanAddAccounts,
      canEditAccounts: destination.membersCanEditAccounts,
      canDeleteAccounts: destination.membersCanDeleteAccounts,
    },
    {
      canAddAccounts: membership.canAddAccountsOverride,
      canEditAccounts: membership.canEditAccountsOverride,
      canDeleteAccounts: membership.canDeleteAccountsOverride,
    },
  );
  return effective.permissions.canAddAccounts ? authorizedDestination : undefined;
}

async function isCurrentlyAuthorized(
  database: PrismaDatabase,
  actorUserId: string,
  request: EncryptedVaultImport,
): Promise<boolean> {
  const expectedType = request.destination.kind === "NEW_SHARED" ? "SHARED" : request.destination.vaultType;
  const vault = await database.vault.findFirst({
    where: { id: request.destination.vaultId, type: expectedType, lifecycle: "ACTIVE", deletedAt: null },
    select: {
      ownerId: true,
      membersCanAddAccounts: true,
      membersCanEditAccounts: true,
      membersCanDeleteAccounts: true,
      members: {
        where: { userId: actorUserId, role: "VIEWER", status: "ACTIVE" },
        select: {
          canAddAccountsOverride: true,
          canEditAccountsOverride: true,
          canDeleteAccountsOverride: true,
        },
        take: 1,
      },
    },
  });
  if (!vault) return false;
  if (vault.ownerId === actorUserId) return true;
  if (request.destination.kind !== "EXISTING" || request.destination.vaultType !== "SHARED") return false;
  const membership = vault.members[0];
  if (!membership) return false;
  return effectiveSharedVaultAccountPermissions(
    "VIEWER",
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
  ).permissions.canAddAccounts;
}

async function replayResult(
  transaction: Prisma.TransactionClient,
  request: EncryptedVaultImport,
  vaultCreated: boolean,
): Promise<EncryptedVaultImportResult> {
  const accounts = request.accounts.length
    ? await transaction.authenticatorAccount.findMany({
        where: { id: { in: request.accounts.map(({ id }) => id) }, vaultId: request.destination.vaultId },
        select: { id: true },
      })
    : [];
  return accounts.length === request.accounts.length
    ? {
        status: "REPLAYED",
        vaultId: request.destination.vaultId,
        accountIds: request.accounts.map(({ id }) => id),
        vaultCreated,
      }
    : { status: "CONFLICT" };
}

function samePublicKey(value: unknown, expected: JsonWebKey): boolean {
  const parsed = publicEncryptionKeySchema.safeParse(value);
  if (!parsed.success) return false;
  const current = parsed.data;
  return (
    current.kty === expected.kty &&
    current.crv === expected.crv &&
    current.x === expected.x &&
    current.y === expected.y &&
    current.ext === expected.ext &&
    JSON.stringify(current.key_ops) === JSON.stringify(expected.key_ops)
  );
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}
