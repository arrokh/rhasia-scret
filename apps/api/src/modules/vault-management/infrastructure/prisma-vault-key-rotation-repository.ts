import { ACCOUNT_RECOVERY_DAYS } from "@api/modules/authenticator-account/domain/account-retention-policy";
import { appendVaultAuditEvent } from "@api/modules/audit/infrastructure/prisma-vault-audit-appender";
import { MAX_ROTATION_ACCOUNTS, MAX_ROTATION_MEMBER_PACKAGES } from "@api/http/validation";
import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";

export type VaultKeyRotationSnapshot = {
  vaultId: string;
  encryptedName: Uint8Array;
  encryptionVersion: number;
  currentKeyVersion: number | null;
  pendingInvitationCount: number;
  accounts: Array<{
    id: string;
    encryptedPayload: Uint8Array;
    encryptionVersion: number;
    revision: number;
    deletedAt: Date | null;
  }>;
  members: Array<{
    userId: string;
    keyVersion: number | null;
    publicKey: JsonWebKey | null;
  }>;
};

export type VaultKeyRotation = {
  expectedEncryptedName: Uint8Array;
  encryptedName: Uint8Array;
  encryptionVersion: number;
  expectedKeyVersion: number;
  keyVersion: number;
  accounts: Array<{ id: string; revision: number; encryptedPayload: Uint8Array }>;
  memberPackages: Array<{ userId: string; expectedPublicKey: JsonWebKey; encryptedVaultKey: Uint8Array }>;
};

export class PrismaVaultKeyRotationRepository {
  public constructor(private readonly database: PrismaDatabase) {}

  public async snapshot(ownerId: string, vaultId: string): Promise<VaultKeyRotationSnapshot | null> {
    const now = new Date();
    const legacyRecoveryCutoff = new Date(now.getTime() - ACCOUNT_RECOVERY_DAYS * 24 * 60 * 60 * 1_000);
    const vault = await this.database.vault.findFirst({
      where: { id: vaultId, ownerId, type: "SHARED", lifecycle: "ACTIVE", deletedAt: null },
      select: {
        id: true,
        encryptedName: true,
        encryptionVersion: true,
        members: {
          where: { status: "ACTIVE" },
          orderBy: { userId: "asc" },
          take: MAX_ROTATION_MEMBER_PACKAGES + 1,
          select: {
            userId: true,
            keyVersion: true,
            encryptedVaultKey: true,
            user: { select: { cryptoProfile: { select: { userEncryptionPublicKey: true } } } },
          },
        },
        accounts: {
          where: {
            OR: [
              { deletedAt: null },
              { purgeAfter: { gt: now } },
              { purgeAfter: null, deletedAt: { gt: legacyRecoveryCutoff } },
            ],
          },
          orderBy: { id: "asc" },
          take: MAX_ROTATION_ACCOUNTS + 1,
          select: { id: true, encryptedPayload: true, encryptionVersion: true, revision: true, deletedAt: true },
        },
      },
    });
    if (!vault?.encryptedName) return null;
    const pendingInvitationCount = await this.database.vaultInvitation.count({
      where: { vaultId, status: "PENDING", expiresAt: { gt: now } },
    });
    const keyVersions = new Set(vault.members.map((member) => member.keyVersion));
    const currentKeyVersion =
      keyVersions.size === 1 && typeof vault.members[0]?.keyVersion === "number" ? vault.members[0].keyVersion : null;

    return {
      vaultId: vault.id,
      encryptedName: copyBytes(vault.encryptedName),
      encryptionVersion: vault.encryptionVersion,
      currentKeyVersion,
      pendingInvitationCount,
      accounts: vault.accounts.map((account) => ({
        id: account.id,
        encryptedPayload: copyBytes(account.encryptedPayload),
        encryptionVersion: account.encryptionVersion,
        revision: account.revision,
        deletedAt: account.deletedAt,
      })),
      members: vault.members.map((member) => ({
        userId: member.userId,
        keyVersion: member.encryptedVaultKey ? member.keyVersion : null,
        publicKey: member.user.cryptoProfile?.userEncryptionPublicKey
          ? (member.user.cryptoProfile.userEncryptionPublicKey as JsonWebKey)
          : null,
      })),
    };
  }

  public async rotate(ownerId: string, vaultId: string, rotation: VaultKeyRotation): Promise<boolean> {
    return this.database.$transaction(async (tx) => {
      const vaultLocks = await tx.$queryRaw<Array<{ id: string; encryptedName: Uint8Array }>>`
        SELECT "id", "encrypted_name" AS "encryptedName"
        FROM "vaults"
        WHERE "id" = ${vaultId}
          AND "owner_id" = ${ownerId}
          AND "type" = 'SHARED'
          AND "lifecycle" = 'ACTIVE'
          AND "deleted_at" IS NULL
        FOR UPDATE
      `;
      if (!vaultLocks[0] || !sameBytes(vaultLocks[0].encryptedName, rotation.expectedEncryptedName)) return false;
      const now = new Date();
      const legacyRecoveryCutoff = new Date(now.getTime() - ACCOUNT_RECOVERY_DAYS * 24 * 60 * 60 * 1_000);
      await tx.$queryRaw<Array<{ user_id: string }>>`
        SELECT "user_id"
        FROM "vault_members"
        WHERE "vault_id" = ${vaultId} AND "status" = 'ACTIVE'
        ORDER BY "user_id"
        FOR UPDATE
      `;
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "authenticator_accounts"
        WHERE "vault_id" = ${vaultId}
          AND (
            "deleted_at" IS NULL
            OR "purge_after" > ${now}
            OR ("purge_after" IS NULL AND "deleted_at" > ${legacyRecoveryCutoff})
          )
        ORDER BY "id"
        FOR UPDATE
      `;

      const vault = await tx.vault.findFirst({
        where: { id: vaultId, ownerId, type: "SHARED", lifecycle: "ACTIVE", deletedAt: null },
        include: {
          members: {
            where: { status: "ACTIVE" },
            take: MAX_ROTATION_MEMBER_PACKAGES + 1,
            select: {
              userId: true,
              keyVersion: true,
              user: { select: { cryptoProfile: { select: { userEncryptionPublicKey: true } } } },
            },
          },
          accounts: {
            where: {
              OR: [
                { deletedAt: null },
                { purgeAfter: { gt: now } },
                { purgeAfter: null, deletedAt: { gt: legacyRecoveryCutoff } },
              ],
            },
            take: MAX_ROTATION_ACCOUNTS + 1,
            select: { id: true, revision: true },
          },
        },
      });
      if (
        !vault ||
        rotation.keyVersion !== rotation.expectedKeyVersion + 1 ||
        vault.members.some((member) => member.keyVersion !== rotation.expectedKeyVersion) ||
        !sameIds(
          vault.members.map((member) => member.userId),
          rotation.memberPackages.map((member) => member.userId),
        ) ||
        !sameIds(
          vault.accounts.map((account) => account.id),
          rotation.accounts.map((account) => account.id),
        ) ||
        vault.accounts.some(
          (account) => rotation.accounts.find(({ id }) => id === account.id)?.revision !== account.revision,
        ) ||
        vault.members.some((member) => {
          const submitted = rotation.memberPackages.find(({ userId }) => userId === member.userId);
          return (
            !submitted ||
            !samePublicKey(member.user.cryptoProfile?.userEncryptionPublicKey, submitted.expectedPublicKey)
          );
        })
      )
        return false;

      await tx.vault.update({
        where: { id: vaultId },
        data: { encryptedName: copyBytes(rotation.encryptedName), encryptionVersion: rotation.encryptionVersion },
      });
      for (const member of rotation.memberPackages) {
        await tx.vaultMember.update({
          where: { vaultId_userId: { vaultId, userId: member.userId } },
          data: { encryptedVaultKey: copyBytes(member.encryptedVaultKey), keyVersion: rotation.keyVersion },
        });
      }
      for (const account of rotation.accounts) {
        await tx.authenticatorAccount.update({
          where: { id: account.id },
          data: { encryptedPayload: copyBytes(account.encryptedPayload), revision: { increment: 1 } },
        });
      }
      await tx.vaultInvitation.deleteMany({ where: { vaultId, status: "PENDING" } });
      await appendVaultAuditEvent(tx, {
        vaultId,
        ownerId,
        actorUserId: ownerId,
        action: "VAULT_KEY_ROTATED",
      });
      return true;
    });
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  return left.every((byte, index) => byte === right[index]);
}

function sameIds(expected: string[], actual: string[]): boolean {
  if (expected.length !== actual.length) return false;
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  return (
    expectedSet.size === expected.length &&
    actualSet.size === actual.length &&
    [...expectedSet].every((id) => actualSet.has(id))
  );
}

function samePublicKey(left: unknown, right: JsonWebKey): boolean {
  return stablePublicKey(left) === stablePublicKey(right);
}

function stablePublicKey(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const serialized = JSON.stringify(
    Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))),
  );
  return typeof serialized === "string" ? serialized : null;
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}
