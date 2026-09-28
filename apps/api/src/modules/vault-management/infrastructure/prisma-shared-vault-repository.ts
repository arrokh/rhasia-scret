import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";
import { sha256Digest, toBase64Url } from "@api/shared/infrastructure/crypto";
import type {
  EncryptedPayloadMigration,
  EncryptedPayloadMigrationResult,
} from "@api/shared/application/encrypted-payload-migration";
import { publicEncryptionKeySchema } from "@api/http/public-encryption-key";
import { Vault } from "../domain/vault";
import {
  SharedVaultIdentityConflictError,
  SharedVaultKeyVersionConflictError,
  type NewSharedVault,
  type SharedVaultRepository,
} from "../application/shared-vault-repository";

export class PrismaSharedVaultRepository implements SharedVaultRepository {
  public constructor(private readonly database: PrismaDatabase) {}
  public async create(ownerId: string, vault: NewSharedVault): Promise<Vault> {
    const created = await this.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ownerId}))`;
      const profile = await transaction.userCryptoProfile.findUnique({
        where: { userId: ownerId },
        select: { userEncryptionPublicKey: true },
      });
      if (!profile || !samePublicKey(profile.userEncryptionPublicKey, vault.expectedOwnerPublicKey))
        throw new SharedVaultIdentityConflictError("User Encryption Key Pair changed before Vault creation.");
      return transaction.vault.create({
        data: {
          ...(vault.id ? { id: vault.id } : {}),
          ownerId,
          type: "SHARED",
          lifecycle: "ACTIVE",
          encryptedName: copyBytes(vault.encryptedName),
          encryptionVersion: vault.encryptionVersion,
          members: {
            create: {
              userId: ownerId,
              role: "OWNER",
              encryptedVaultKey: copyBytes(vault.encryptedOwnerVaultKey),
              keyVersion: vault.encryptionVersion,
            },
          },
        },
      });
    });
    return new Vault(created.id, "SHARED", created.ownerId, "ACTIVE");
  }

  public async migrateName(
    actorUserId: string,
    vaultId: string,
    expectedKeyVersion: number,
    migration: EncryptedPayloadMigration,
  ): Promise<EncryptedPayloadMigrationResult> {
    const replacement = copyBytes(migration.replacementCiphertext);
    try {
      if (!validNameMigration(migration, replacement)) return "conflict";
      return await this.database.$transaction(async (transaction) => {
        const access = await transaction.$queryRaw<
          Array<{
            encryptedName: Uint8Array | null;
            encryptionVersion: number;
            role: string;
            status: string;
            keyVersion: number | null;
          }>
        >`
          SELECT
            vault."encrypted_name" AS "encryptedName",
            vault."encryption_version" AS "encryptionVersion",
            member."role" AS "role",
            member."status" AS "status",
            member."key_version" AS "keyVersion"
          FROM "vaults" AS vault
          INNER JOIN "vault_members" AS member ON member."vault_id" = vault."id"
          WHERE vault."id" = ${vaultId}
            AND member."user_id" = ${actorUserId}
            AND member."status" = 'ACTIVE'
            AND member."role" IN ('OWNER', 'VIEWER')
            AND vault."type" = 'SHARED'
            AND vault."lifecycle" = 'ACTIVE'
            AND vault."deleted_at" IS NULL
          FOR UPDATE OF vault, member
        `;
        const membership = access[0];
        if (
          !membership?.encryptedName ||
          membership.encryptionVersion !== 1 ||
          membership.keyVersion !== expectedKeyVersion
        )
          return "conflict";
        const current = copyBytes(membership.encryptedName);
        try {
          const currentDigest = digestString(current);
          if (currentDigest === migration.replacementCiphertextDigest) return "already-committed";
          if (current[0] !== migration.expectedEnvelopeVersion || currentDigest !== migration.expectedCiphertextDigest)
            return "conflict";
          const updated = await transaction.vault.updateMany({
            where: {
              id: vaultId,
              type: "SHARED",
              lifecycle: "ACTIVE",
              deletedAt: null,
              encryptionVersion: membership.encryptionVersion,
              encryptedName: current,
            },
            data: { encryptedName: replacement },
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

  public async rename(
    ownerId: string,
    vaultId: string,
    encryptedName: Uint8Array,
    encryptionVersion: number,
    expectedKeyVersion: number,
  ): Promise<boolean> {
    return this.database.$transaction(async (transaction) => {
      const vault = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "vaults"
        WHERE "id" = ${vaultId}
          AND "owner_id" = ${ownerId}
          AND "type" = 'SHARED'
          AND "lifecycle" = 'ACTIVE'
          AND "deleted_at" IS NULL
        FOR UPDATE
      `;
      if (!vault[0]) return false;
      const ownerMembership = await transaction.vaultMember.findUnique({
        where: { vaultId_userId: { vaultId, userId: ownerId } },
        select: { role: true, status: true, keyVersion: true },
      });
      if (
        ownerMembership?.role !== "OWNER" ||
        ownerMembership.status !== "ACTIVE" ||
        ownerMembership.keyVersion !== expectedKeyVersion
      )
        throw new SharedVaultKeyVersionConflictError("Vault Encryption Key generation changed before rename.");
      const result = await transaction.vault.updateMany({
        where: { id: vaultId, ownerId, type: "SHARED", lifecycle: "ACTIVE", deletedAt: null },
        data: { encryptedName: copyBytes(encryptedName), encryptionVersion },
      });
      return result.count === 1;
    });
  }
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

function validNameMigration(migration: EncryptedPayloadMigration, replacement: Uint8Array): boolean {
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
