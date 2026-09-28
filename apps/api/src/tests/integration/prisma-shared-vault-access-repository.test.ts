import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaSharedVaultAccessRepository } from "@api/modules/vault-membership/infrastructure/prisma-shared-vault-access-repository";
import type { EncryptedPayloadMigration } from "@api/shared/application/encrypted-payload-migration";
import { sha256Digest, toBase64Url } from "@api/shared/infrastructure/crypto";
import { prisma } from "@api/tests/integration/prisma";

const userIds: string[] = [];

afterEach(async () => {
  if (userIds.length) {
    const vaults = await prisma.vault.findMany({ where: { ownerId: { in: userIds } }, select: { id: true } });
    const vaultIds = vaults.map((vault) => vault.id);
    await prisma.authenticatorAccount.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.vaultMember.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.vault.deleteMany({ where: { id: { in: vaultIds } } });
    await prisma.applicationUser.deleteMany({ where: { id: { in: userIds.splice(0) } } });
  }
  await prisma.$disconnect();
});

describe("PrismaSharedVaultAccessRepository", () => {
  it.skipIf(!process.env.DATABASE_URL)(
    "atomically migrates one active member key wrap and recognizes exact retries",
    async () => {
      const user = await prisma.applicationUser.create({ data: { email: `${randomUUID()}@example.test` } });
      userIds.push(user.id);
      const source = new TextEncoder().encode(
        JSON.stringify({
          version: 1,
          nonce: "synthetic-old",
          ciphertext: "synthetic-ciphertext",
          ephemeralPublicKey: {},
        }),
      );
      const replacement = new TextEncoder().encode(
        JSON.stringify({
          version: 2,
          nonce: "A".repeat(16),
          ciphertext: "B".repeat(64),
          ephemeralPublicKey: {
            kty: "EC",
            crv: "P-256",
            x: "A".repeat(43),
            y: "B".repeat(43),
            ext: true,
            key_ops: [],
          },
        }),
      );
      const vault = await prisma.vault.create({
        data: {
          ownerId: user.id,
          type: "SHARED",
          lifecycle: "ACTIVE",
          encryptedName: Uint8Array.from([1, 2, 3]),
          encryptionVersion: 1,
          members: {
            create: { userId: user.id, role: "OWNER", encryptedVaultKey: source, keyVersion: 4 },
          },
        },
      });
      const repository = new PrismaSharedVaultAccessRepository(prisma);
      const migration = encryptedMigration(source, replacement);
      const privateKeyReplacement = new TextEncoder().encode(
        JSON.stringify({
          version: 2,
          nonce: "AAAAAAAAAAAAAAAA",
          ciphertext: "A".repeat(64),
          ephemeralPublicKey: {
            kty: "EC",
            crv: "P-256",
            x: "A".repeat(43),
            y: "B".repeat(43),
            ext: true,
            key_ops: [],
            d: "C".repeat(43),
          },
        }),
      );
      const privateKeyMigration = encryptedMigration(source, privateKeyReplacement);

      await expect(repository.migrateKeyWrap(user.id, vault.id, 4, privateKeyMigration)).resolves.toBe("conflict");
      await expect(
        prisma.vaultMember.findUnique({
          where: { vaultId_userId: { vaultId: vault.id, userId: user.id } },
          select: { encryptedVaultKey: true },
        }),
      ).resolves.toEqual({ encryptedVaultKey: source });
      await expect(repository.migrateKeyWrap(user.id, vault.id, 4, migration)).resolves.toBe("committed");
      await expect(repository.migrateKeyWrap(user.id, vault.id, 4, migration)).resolves.toBe("already-committed");
      await expect(repository.migrateKeyWrap(user.id, vault.id, 3, migration)).resolves.toBe("conflict");
      await expect(
        prisma.vaultMember.findUnique({
          where: { vaultId_userId: { vaultId: vault.id, userId: user.id } },
          select: { encryptedVaultKey: true, keyVersion: true },
        }),
      ).resolves.toEqual({ encryptedVaultKey: replacement, keyVersion: 4 });
      source.fill(0);
      replacement.fill(0);
      privateKeyReplacement.fill(0);
    },
  );

  it.skipIf(!process.env.DATABASE_URL)(
    "lists active encrypted Shared Vault material, accounts, and effective permissions for a member",
    async () => {
      const user = await prisma.applicationUser.create({
        data: { email: `${randomUUID()}@example.test` },
      });
      userIds.push(user.id);
      const vault = await prisma.vault.create({
        data: {
          ownerId: user.id,
          type: "SHARED",
          lifecycle: "ACTIVE",
          encryptedName: Uint8Array.from([1, 2, 3]),
          encryptionVersion: 1,
          members: {
            create: { userId: user.id, role: "OWNER", encryptedVaultKey: Uint8Array.from([4, 5, 6]), keyVersion: 1 },
          },
          accounts: { create: { encryptedPayload: Uint8Array.from([7, 8, 9]), encryptionVersion: 1 } },
        },
      });

      const listed = await new PrismaSharedVaultAccessRepository(prisma).listForMember(user.id);

      expect(listed).toEqual([
        expect.objectContaining({
          vaultId: vault.id,
          role: "OWNER",
          encryptedName: Uint8Array.from([1, 2, 3]),
          encryptedVaultKey: Uint8Array.from([4, 5, 6]),
          effectiveAccountPermissions: {
            permissions: { canAddAccounts: true, canEditAccounts: true, canDeleteAccounts: true },
            sources: { canAddAccounts: "OWNER", canEditAccounts: "OWNER", canDeleteAccounts: "OWNER" },
          },
          accounts: [expect.objectContaining({ encryptedPayload: Uint8Array.from([7, 8, 9]) })],
        }),
      ]);
    },
  );
});

function encryptedMigration(expected: Uint8Array, replacement: Uint8Array): EncryptedPayloadMigration {
  const expectedDigest = digest(expected);
  const replacementDigest = digest(replacement);
  return {
    expectedEnvelopeVersion: 1,
    replacementEnvelopeVersion: 2,
    expectedCiphertextDigest: expectedDigest,
    replacementCiphertextDigest: replacementDigest,
    replacementCiphertext: replacement,
    operationId: replacementDigest,
  };
}

function digest(bytes: Uint8Array): string {
  const value = sha256Digest(bytes);
  try {
    return toBase64Url(value);
  } finally {
    value.fill(0);
  }
}
