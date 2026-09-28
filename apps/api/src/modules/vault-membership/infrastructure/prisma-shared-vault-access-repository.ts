import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";
import type {
  EncryptedPayloadMigration,
  EncryptedPayloadMigrationResult,
} from "@api/shared/application/encrypted-payload-migration";
import { sha256Digest, toBase64Url } from "@api/shared/infrastructure/crypto";
import type { SharedVaultAccess, SharedVaultAccessRepository } from "../application/shared-vault-access-repository";
import { effectiveSharedVaultAccountPermissions } from "@rhasia-scret/client-vault-core/modules/vault-membership/domain/shared-vault-account-permissions";

export class PrismaSharedVaultAccessRepository implements SharedVaultAccessRepository {
  public constructor(private readonly database: PrismaDatabase) {}
  public async listForMember(userId: string): Promise<SharedVaultAccess[]> {
    const memberships = await this.database.vaultMember.findMany({
      where: { userId, status: "ACTIVE", vault: { type: "SHARED", lifecycle: "ACTIVE", deletedAt: null } },
      include: {
        vault: {
          include: {
            accounts: {
              where: { deletedAt: null },
              select: { id: true, encryptedPayload: true, encryptionVersion: true, revision: true },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    return memberships.flatMap((membership) => {
      if (!membership.vault.encryptedName || !membership.encryptedVaultKey || !membership.keyVersion) return [];
      if (membership.role !== "OWNER" && membership.role !== "VIEWER") return [];
      return [
        {
          vaultId: membership.vaultId,
          role: membership.role,
          effectiveAccountPermissions: effectiveSharedVaultAccountPermissions(
            membership.role,
            {
              canAddAccounts: membership.vault.membersCanAddAccounts,
              canEditAccounts: membership.vault.membersCanEditAccounts,
              canDeleteAccounts: membership.vault.membersCanDeleteAccounts,
            },
            {
              canAddAccounts: membership.canAddAccountsOverride,
              canEditAccounts: membership.canEditAccountsOverride,
              canDeleteAccounts: membership.canDeleteAccountsOverride,
            },
          ),
          encryptedName: copyBytes(membership.vault.encryptedName),
          encryptionVersion: membership.vault.encryptionVersion,
          encryptedVaultKey: copyBytes(membership.encryptedVaultKey),
          keyVersion: membership.keyVersion,
          accounts: membership.vault.accounts.map((account) => ({
            id: account.id,
            encryptedPayload: copyBytes(account.encryptedPayload),
            encryptionVersion: account.encryptionVersion,
            revision: account.revision,
          })),
        },
      ];
    });
  }

  public async migrateKeyWrap(
    userId: string,
    vaultId: string,
    expectedKeyVersion: number,
    migration: EncryptedPayloadMigration,
  ): Promise<EncryptedPayloadMigrationResult> {
    const replacement = copyBytes(migration.replacementCiphertext);
    try {
      if (!validKeyWrapMigration(migration, replacement)) return "conflict";
      return await this.database.$transaction(async (transaction) => {
        const rows = await transaction.$queryRaw<
          Array<{ encryptedVaultKey: Uint8Array | null; keyVersion: number | null }>
        >`
          SELECT member."encrypted_vault_key" AS "encryptedVaultKey", member."key_version" AS "keyVersion"
          FROM "vault_members" AS member
          INNER JOIN "vaults" AS vault ON vault."id" = member."vault_id"
          WHERE member."vault_id" = ${vaultId}
            AND member."user_id" = ${userId}
            AND member."status" = 'ACTIVE'
            AND member."role" IN ('OWNER', 'VIEWER')
            AND vault."type" = 'SHARED'
            AND vault."lifecycle" = 'ACTIVE'
            AND vault."deleted_at" IS NULL
          FOR UPDATE OF member, vault
        `;
        const membership = rows[0];
        if (!membership?.encryptedVaultKey || membership.keyVersion !== expectedKeyVersion) return "conflict";
        const current = copyBytes(membership.encryptedVaultKey);
        try {
          const currentDigest = digestString(current);
          if (currentDigest === migration.replacementCiphertextDigest) return "already-committed";
          if (currentDigest !== migration.expectedCiphertextDigest || !isLegacyKeyWrapCiphertext(current))
            return "conflict";
          const updated = await transaction.vaultMember.updateMany({
            where: {
              vaultId,
              userId,
              status: "ACTIVE",
              keyVersion: expectedKeyVersion,
              encryptedVaultKey: current,
            },
            data: { encryptedVaultKey: replacement },
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

  public async getForMember(userId: string, vaultId: string): Promise<SharedVaultAccess | null> {
    const membership = await this.database.vaultMember.findFirst({
      where: { vaultId, userId, status: "ACTIVE", vault: { type: "SHARED", lifecycle: "ACTIVE", deletedAt: null } },
      include: {
        vault: {
          include: {
            accounts: {
              where: { deletedAt: null },
              select: { id: true, encryptedPayload: true, encryptionVersion: true, revision: true },
            },
          },
        },
      },
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
          canDeleteAccounts: membership.vault.membersCanDeleteAccounts,
        },
        {
          canAddAccounts: membership.canAddAccountsOverride,
          canEditAccounts: membership.canEditAccountsOverride,
          canDeleteAccounts: membership.canDeleteAccountsOverride,
        },
      ),
      encryptedName: copyBytes(membership.vault.encryptedName),
      encryptionVersion: membership.vault.encryptionVersion,
      encryptedVaultKey: copyBytes(membership.encryptedVaultKey),
      keyVersion: membership.keyVersion,
      accounts: membership.vault.accounts.map((account) => ({
        id: account.id,
        encryptedPayload: copyBytes(account.encryptedPayload),
        encryptionVersion: account.encryptionVersion,
        revision: account.revision,
      })),
    };
  }
}

function validKeyWrapMigration(migration: EncryptedPayloadMigration, replacement: Uint8Array): boolean {
  if (
    migration.expectedEnvelopeVersion !== 1 ||
    migration.replacementEnvelopeVersion !== 2 ||
    migration.expectedCiphertextDigest.length !== 43 ||
    migration.replacementCiphertextDigest.length !== 43 ||
    migration.operationId !== migration.replacementCiphertextDigest ||
    replacement.length < 29 ||
    replacement.length > 1_000_000 ||
    replacement[0] !== 0x7b ||
    digestString(replacement) !== migration.replacementCiphertextDigest
  )
    return false;
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(replacement));
  } catch {
    return false;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).sort().join(",") === "ciphertext,ephemeralPublicKey,nonce,version" &&
    record.version === 2 &&
    isBase64(record.ciphertext, 64) &&
    isBase64(record.nonce, 16) &&
    isPublicP256Key(record.ephemeralPublicKey)
  );
}

function isBase64(value: unknown, length: number): value is string {
  return typeof value === "string" && value.length === length && /^[A-Za-z0-9+/]+$/.test(value);
}

function isPublicP256Key(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const key = value as Record<string, unknown>;
  const allowedFields = new Set(["crv", "ext", "key_ops", "kty", "x", "y"]);
  if (Object.keys(key).some((field) => !allowedFields.has(field))) return false;
  if ("ext" in key && typeof key.ext !== "boolean") return false;
  if ("key_ops" in key && (!Array.isArray(key.key_ops) || key.key_ops.length !== 0)) return false;
  return (
    key.kty === "EC" &&
    key.crv === "P-256" &&
    typeof key.x === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(key.x) &&
    typeof key.y === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(key.y)
  );
}

function isLegacyKeyWrapCiphertext(bytes: Uint8Array): boolean {
  if (bytes[0] !== 0x7b) return bytes[0] === 1;
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return Reflect.get(value, "version") === 1;
  } catch {
    return false;
  }
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
