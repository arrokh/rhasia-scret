import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";
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

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}
