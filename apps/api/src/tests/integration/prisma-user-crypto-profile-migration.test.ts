import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { sha256Digest, toBase64Url } from "@api/shared/infrastructure/crypto";
import { PrismaUserCryptoProfileRepository } from "@api/modules/identity/infrastructure/prisma-user-crypto-profile-repository";
import { prisma } from "@api/tests/integration/prisma";
import type {
  UserCryptoProfileMigration,
  UserEncryptionPrivateKeyMigration,
} from "@api/modules/identity/application/user-crypto-profile-repository";

const userIds: string[] = [];
const publicKey = { kty: "EC", crv: "P-256", x: "A".repeat(43), y: "B".repeat(43) } satisfies JsonWebKey;

afterEach(async () => {
  const ids = userIds.splice(0);
  await prisma.userCryptoProfile.deleteMany({ where: { userId: { in: ids } } });
  await prisma.applicationUser.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe("PrismaUserCryptoProfileRepository legacy identity migration", () => {
  it.skipIf(!process.env.DATABASE_URL)("atomically migrates only the ciphertext and recognizes retries", async () => {
    const { userId, legacyCiphertext, replacementCiphertext } = await createLegacyProfile();
    const repository = new PrismaUserCryptoProfileRepository(prisma);
    const migration = migrationFor(legacyCiphertext, replacementCiphertext);

    await expect(repository.migrateUserEncryptionPrivateKey(userId, migration)).resolves.toBe("committed");
    await expect(repository.migrateUserEncryptionPrivateKey(userId, migration)).resolves.toBe("already-committed");
    await expect(
      prisma.userCryptoProfile.findUnique({
        where: { userId },
        select: {
          userEncryptionPublicKey: true,
          encryptedUserPrivateKey: true,
          userEncryptionKeyVersion: true,
          wrappedUserRootKey: true,
          encryptedPersonalVaultKey: true,
        },
      }),
    ).resolves.toEqual({
      userEncryptionPublicKey: publicKey,
      encryptedUserPrivateKey: replacementCiphertext,
      userEncryptionKeyVersion: 1,
      wrappedUserRootKey: bytes(1, "synthetic-wrapped-root-key"),
      encryptedPersonalVaultKey: bytes(1, "synthetic-personal-vault-key"),
    });
  });

  it.skipIf(!process.env.DATABASE_URL)("preserves the old ciphertext when the expected digest is stale", async () => {
    const { userId, legacyCiphertext, replacementCiphertext } = await createLegacyProfile();
    const repository = new PrismaUserCryptoProfileRepository(prisma);
    const migration = migrationFor(legacyCiphertext, replacementCiphertext);
    migration.expectedCiphertextDigest = toBase64Url(sha256Digest(bytes(1, "different-legacy-envelope")));

    await expect(repository.migrateUserEncryptionPrivateKey(userId, migration)).resolves.toBe("conflict");
    await expect(
      prisma.userCryptoProfile.findUnique({ where: { userId }, select: { encryptedUserPrivateKey: true } }),
    ).resolves.toEqual({ encryptedUserPrivateKey: legacyCiphertext });
  });

  it.skipIf(!process.env.DATABASE_URL)(
    "atomically migrates profile wrappers and recognizes identical retries",
    async () => {
      const { userId } = await createLegacyProfile();
      const repository = new PrismaUserCryptoProfileRepository(prisma);
      const migration = profileMigration();

      await expect(repository.migrateUserCryptoProfile(userId, migration)).resolves.toBe("committed");
      await expect(repository.migrateUserCryptoProfile(userId, migration)).resolves.toBe("already-committed");
      await expect(
        prisma.userCryptoProfile.findUnique({
          where: { userId },
          select: { wrappedUserRootKey: true, encryptedPersonalVaultKey: true, vaultUnlockSalt: true },
        }),
      ).resolves.toEqual({
        wrappedUserRootKey: migration.wrappedUserRootKey?.replacementCiphertext,
        encryptedPersonalVaultKey: migration.encryptedPersonalVaultKey?.replacementCiphertext,
        vaultUnlockSalt: bytes(1, "synthetic-vault-unlock-salt"),
      });
    },
  );

  it.skipIf(!process.env.DATABASE_URL)("preserves profile wrappers when any expected source is stale", async () => {
    const { userId } = await createLegacyProfile();
    const repository = new PrismaUserCryptoProfileRepository(prisma);
    const migration = profileMigration();
    migration.encryptedPersonalVaultKey!.expectedCiphertext = bytes(1, "different-profile-source");

    await expect(repository.migrateUserCryptoProfile(userId, migration)).resolves.toBe("conflict");
    await expect(
      prisma.userCryptoProfile.findUnique({
        where: { userId },
        select: { wrappedUserRootKey: true, encryptedPersonalVaultKey: true },
      }),
    ).resolves.toEqual({
      wrappedUserRootKey: bytes(1, "synthetic-wrapped-root-key"),
      encryptedPersonalVaultKey: bytes(1, "synthetic-personal-vault-key"),
    });
  });

  it.skipIf(!process.env.DATABASE_URL)("serializes concurrent retries from the same migration operation", async () => {
    const { userId, legacyCiphertext, replacementCiphertext } = await createLegacyProfile();
    const repository = new PrismaUserCryptoProfileRepository(prisma);
    const migration = migrationFor(legacyCiphertext, replacementCiphertext);

    const results = await Promise.all([
      repository.migrateUserEncryptionPrivateKey(userId, migration),
      repository.migrateUserEncryptionPrivateKey(userId, migration),
    ]);

    expect(results.sort()).toEqual(["already-committed", "committed"]);
    await expect(
      prisma.userCryptoProfile.findUnique({ where: { userId }, select: { encryptedUserPrivateKey: true } }),
    ).resolves.toEqual({ encryptedUserPrivateKey: replacementCiphertext });
  });
});

async function createLegacyProfile() {
  const user = await prisma.applicationUser.create({
    data: { email: `identity-migration-${randomUUID()}@example.test` },
  });
  userIds.push(user.id);
  const legacyCiphertext = bytes(1, "synthetic-legacy-user-encryption-private-key");
  const replacementCiphertext = bytes(2, "synthetic-context-bound-user-private-key");
  await prisma.userCryptoProfile.create({
    data: {
      userId: user.id,
      vaultUnlockSalt: bytes(1, "synthetic-vault-unlock-salt"),
      wrappedUserRootKey: bytes(1, "synthetic-wrapped-root-key"),
      rootKeyWrappingVersion: 1,
      encryptedPersonalVaultKey: bytes(1, "synthetic-personal-vault-key"),
      personalVaultKeyEncryptionVersion: 1,
      userEncryptionPublicKey: publicKey,
      encryptedUserPrivateKey: legacyCiphertext,
      userEncryptionKeyVersion: 1,
    },
  });
  return { userId: user.id, legacyCiphertext, replacementCiphertext };
}

function profileMigration(): UserCryptoProfileMigration {
  return {
    wrappedUserRootKey: {
      expectedCiphertext: bytes(1, "synthetic-wrapped-root-key"),
      replacementCiphertext: bytes(2, "synthetic-wrapped-root-key-v2"),
    },
    encryptedPersonalVaultKey: {
      expectedCiphertext: bytes(1, "synthetic-personal-vault-key"),
      replacementCiphertext: bytes(2, "synthetic-personal-vault-key-v2"),
    },
  };
}

function migrationFor(
  legacyCiphertext: Uint8Array,
  replacementCiphertext: Uint8Array,
): UserEncryptionPrivateKeyMigration {
  const expectedCiphertextDigest = toBase64Url(sha256Digest(legacyCiphertext));
  const replacementCiphertextDigest = toBase64Url(sha256Digest(replacementCiphertext));
  return {
    expectedEnvelopeVersion: 1,
    replacementEnvelopeVersion: 2,
    userEncryptionKeyVersion: 1,
    expectedCiphertextDigest,
    replacementCiphertextDigest,
    encryptedPrivateKey: replacementCiphertext,
    operationId: replacementCiphertextDigest,
  };
}

function bytes(version: 1 | 2, value: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(64);
  bytes[0] = version;
  bytes.set(new TextEncoder().encode(value).slice(0, 63), 1);
  return bytes;
}
