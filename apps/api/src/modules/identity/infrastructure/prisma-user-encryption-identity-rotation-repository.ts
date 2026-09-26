import { Prisma } from "@prisma/client";
import { appendVaultAuditEvent } from "@api/modules/audit/infrastructure/prisma-vault-audit-appender";
import type {
  UserEncryptionIdentityRotation,
  UserEncryptionIdentityRotationRepository,
  UserEncryptionIdentityRotationSnapshot,
} from "../application/user-encryption-identity-rotation-repository";
import { MAX_ROTATION_MEMBER_PACKAGES } from "@api/http/validation";
import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";

export class PrismaUserEncryptionIdentityRotationRepository implements UserEncryptionIdentityRotationRepository {
  public constructor(private readonly database: PrismaDatabase) {}

  public async snapshot(userId: string): Promise<UserEncryptionIdentityRotationSnapshot | null> {
    return this.database.$transaction(
      async (transaction) => {
        const profile = await transaction.userCryptoProfile.findUnique({ where: { userId } });
        if (
          !profile?.userEncryptionPublicKey ||
          !profile.encryptedUserPrivateKey ||
          profile.userEncryptionKeyVersion === null
        )
          return null;
        const memberships = await transaction.vaultMember.findMany({
          where: {
            userId,
            status: "ACTIVE",
            vault: { type: "SHARED", lifecycle: "ACTIVE", deletedAt: null },
          },
          orderBy: { vaultId: "asc" },
          take: MAX_ROTATION_MEMBER_PACKAGES + 1,
          select: {
            vaultId: true,
            encryptedVaultKey: true,
            keyVersion: true,
            vault: { select: { ownerId: true } },
          },
        });
        return {
          publicKey: profile.userEncryptionPublicKey as JsonWebKey,
          encryptedPrivateKey: copyBytes(profile.encryptedUserPrivateKey),
          encryptionVersion: profile.userEncryptionKeyVersion,
          memberships: memberships.map((membership) => ({
            vaultId: membership.vaultId,
            ownerId: membership.vault.ownerId,
            encryptedVaultKey: copyBytes(membership.encryptedVaultKey ?? new Uint8Array()),
            keyVersion: membership.keyVersion ?? 0,
          })),
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }

  public async rotate(userId: string, rotation: UserEncryptionIdentityRotation): Promise<boolean> {
    try {
      return await this.database.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
        const profile = await tx.userCryptoProfile.findUnique({ where: { userId } });
        if (
          !profile?.userEncryptionPublicKey ||
          !profile.encryptedUserPrivateKey ||
          profile.userEncryptionKeyVersion !== rotation.expectedEncryptionVersion ||
          !samePublicKey(profile.userEncryptionPublicKey, rotation.expectedPublicKey) ||
          !bytesEqual(profile.encryptedUserPrivateKey, rotation.expectedEncryptedPrivateKey)
        )
          return false;

        const initialMemberships = await tx.vaultMember.findMany({
          where: {
            userId,
            status: "ACTIVE",
            vault: { type: "SHARED", lifecycle: "ACTIVE", deletedAt: null },
          },
          orderBy: { vaultId: "asc" },
          select: { vaultId: true },
        });
        if (
          !sameIds(
            initialMemberships.map(({ vaultId }) => vaultId),
            rotation.memberships.map(({ vaultId }) => vaultId),
          )
        )
          return false;
        for (const { vaultId } of initialMemberships) {
          await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id"
            FROM "vaults"
            WHERE "id" = ${vaultId} AND "type" = 'SHARED' AND "lifecycle" = 'ACTIVE' AND "deleted_at" IS NULL
            FOR UPDATE
          `;
        }
        await tx.$queryRaw<Array<{ vault_id: string }>>`
          SELECT "vault_id"
          FROM "vault_members"
          WHERE "user_id" = ${userId} AND "status" = 'ACTIVE'
          ORDER BY "vault_id"
          FOR UPDATE
        `;
        const memberships = await tx.vaultMember.findMany({
          where: {
            userId,
            status: "ACTIVE",
            vault: { type: "SHARED", lifecycle: "ACTIVE", deletedAt: null },
          },
          orderBy: { vaultId: "asc" },
          take: MAX_ROTATION_MEMBER_PACKAGES + 1,
          select: {
            vaultId: true,
            encryptedVaultKey: true,
            keyVersion: true,
            vault: { select: { ownerId: true } },
          },
        });
        if (
          !sameIds(
            memberships.map(({ vaultId }) => vaultId),
            rotation.memberships.map(({ vaultId }) => vaultId),
          ) ||
          memberships.some((membership) => {
            const submitted = rotation.memberships.find(({ vaultId }) => vaultId === membership.vaultId);
            return (
              !submitted ||
              membership.keyVersion !== submitted.expectedKeyVersion ||
              !membership.encryptedVaultKey ||
              !bytesEqual(membership.encryptedVaultKey, submitted.expectedEncryptedVaultKey)
            );
          })
        )
          return false;

        const updatedProfile = await tx.userCryptoProfile.updateMany({
          where: {
            userId,
            userEncryptionPublicKey: { equals: rotation.expectedPublicKey as Prisma.InputJsonValue },
            encryptedUserPrivateKey: copyBytes(rotation.expectedEncryptedPrivateKey),
            userEncryptionKeyVersion: rotation.expectedEncryptionVersion,
          },
          data: {
            userEncryptionPublicKey: rotation.publicKey as Prisma.InputJsonValue,
            encryptedUserPrivateKey: copyBytes(rotation.encryptedPrivateKey),
            userEncryptionKeyVersion: rotation.encryptionVersion,
          },
        });
        if (updatedProfile.count !== 1) return false;

        for (const member of rotation.memberships) {
          const updated = await tx.vaultMember.updateMany({
            where: {
              vaultId: member.vaultId,
              userId,
              status: "ACTIVE",
              keyVersion: member.expectedKeyVersion,
              encryptedVaultKey: copyBytes(member.expectedEncryptedVaultKey),
            },
            data: { encryptedVaultKey: copyBytes(member.encryptedVaultKey) },
          });
          if (updated.count !== 1) throw new IdentityRotationConflictError();
        }
        for (const membership of memberships) {
          await appendVaultAuditEvent(tx, {
            vaultId: membership.vaultId,
            ownerId: membership.vault.ownerId,
            actorUserId: userId,
            action: "USER_ENCRYPTION_KEY_PAIR_ROTATED",
          });
        }
        return true;
      });
    } catch (error) {
      if (error instanceof IdentityRotationConflictError) return false;
      throw error;
    }
  }
}

class IdentityRotationConflictError extends Error {}

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

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}
