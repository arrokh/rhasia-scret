import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaPersonalVaultRepository } from "@api/modules/vault-management/infrastructure/prisma-personal-vault-repository";
import type { EncryptedPayloadMigration } from "@api/shared/application/encrypted-payload-migration";
import { sha256Digest, toBase64Url } from "@api/shared/infrastructure/crypto";
import { prisma } from "@api/tests/integration/prisma";

const userIds: string[] = [];
const vaultIds: string[] = [];

afterEach(async () => {
  const ids = vaultIds.splice(0);
  await prisma.vaultMember.deleteMany({ where: { vaultId: { in: ids } } });
  await prisma.vault.deleteMany({ where: { id: { in: ids } } });
  await prisma.applicationUser.deleteMany({ where: { id: { in: userIds.splice(0) } } });
  await prisma.$disconnect();
});

describe("PrismaPersonalVaultRepository legacy name migration", () => {
  it.skipIf(!process.env.DATABASE_URL)("CASes only the personal Vault name ciphertext", async () => {
    const user = await prisma.applicationUser.create({
      data: { email: `personal-name-migration-${randomUUID()}@example.test` },
    });
    userIds.push(user.id);
    const source = Uint8Array.from([1, 2, 3, 4]);
    const replacement = Uint8Array.from([2, ...new Array<number>(40).fill(7)]);
    const vault = await prisma.vault.create({
      data: {
        ownerId: user.id,
        type: "PERSONAL",
        lifecycle: "ACTIVE",
        encryptedName: source,
        encryptionVersion: 1,
        members: { create: { userId: user.id, role: "OWNER" } },
      },
    });
    vaultIds.push(vault.id);
    const migration = encryptedMigration(source, replacement);
    const repository = new PrismaPersonalVaultRepository(prisma);

    await expect(repository.migrateName(user.id, vault.id, 1, migration)).resolves.toBe("committed");
    await expect(repository.migrateName(user.id, vault.id, 1, migration)).resolves.toBe("already-committed");
    await expect(repository.migrateName(user.id, vault.id, 2, migration)).resolves.toBe("conflict");
    await expect(
      prisma.vault.findUnique({ where: { id: vault.id }, select: { encryptedName: true, encryptionVersion: true } }),
    ).resolves.toEqual({ encryptedName: replacement, encryptionVersion: 1 });
    source.fill(0);
    replacement.fill(0);
  });
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
