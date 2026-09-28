import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaSharedVaultRepository } from "@api/modules/vault-management/infrastructure/prisma-shared-vault-repository";
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

describe("PrismaSharedVaultRepository legacy name migration", () => {
  it.skipIf(!process.env.DATABASE_URL)("allows an active member to CAS the shared ciphertext only", async () => {
    const owner = await createUser();
    const viewer = await createUser();
    const source = Uint8Array.from([1, 2, 3, 4]);
    const replacement = Uint8Array.from([2, ...new Array<number>(40).fill(6)]);
    const vault = await prisma.vault.create({
      data: {
        ownerId: owner.id,
        type: "SHARED",
        lifecycle: "ACTIVE",
        encryptedName: source,
        encryptionVersion: 1,
        members: {
          create: [
            { userId: owner.id, role: "OWNER", encryptedVaultKey: Uint8Array.of(2), keyVersion: 4 },
            { userId: viewer.id, role: "VIEWER", encryptedVaultKey: Uint8Array.of(3), keyVersion: 4 },
          ],
        },
      },
    });
    vaultIds.push(vault.id);
    const migration = encryptedMigration(source, replacement);
    const repository = new PrismaSharedVaultRepository(prisma);

    await expect(repository.migrateName(viewer.id, vault.id, 4, migration)).resolves.toBe("committed");
    await expect(repository.migrateName(owner.id, vault.id, 4, migration)).resolves.toBe("already-committed");
    await expect(
      prisma.vault.findUnique({ where: { id: vault.id }, select: { encryptedName: true, encryptionVersion: true } }),
    ).resolves.toEqual({ encryptedName: replacement, encryptionVersion: 1 });

    await prisma.vaultMember.update({
      where: { vaultId_userId: { vaultId: vault.id, userId: viewer.id } },
      data: { status: "REVOKED" },
    });
    await expect(repository.migrateName(viewer.id, vault.id, 4, migration)).resolves.toBe("conflict");
    source.fill(0);
    replacement.fill(0);
  });
});

async function createUser() {
  const user = await prisma.applicationUser.create({ data: { email: `${randomUUID()}@example.test` } });
  userIds.push(user.id);
  return user;
}

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
