import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaPersonalVaultRepository } from "@api/modules/vault-management/infrastructure/prisma-personal-vault-repository";
import { prisma } from "@api/tests/integration/prisma";

const userIds: string[] = [];

afterEach(async () => {
  if (userIds.length) {
    const vaults = await prisma.vault.findMany({ where: { ownerId: { in: userIds } }, select: { id: true } });
    await prisma.vaultMember.deleteMany({ where: { vaultId: { in: vaults.map((vault) => vault.id) } } });
    await prisma.vault.deleteMany({ where: { ownerId: { in: userIds } } });
    await prisma.applicationUser.deleteMany({ where: { id: { in: userIds.splice(0) } } });
  }
  await prisma.$disconnect();
});

describe("PrismaPersonalVaultRepository", () => {
  it.skipIf(!process.env.DATABASE_URL)("creates exactly one uninitialized Personal Vault for an owner", async () => {
    const user = await prisma.applicationUser.create({
      data: { email: `${randomUUID()}@example.test` },
    });
    userIds.push(user.id);
    const repository = new PrismaPersonalVaultRepository(prisma);
    const first = await repository.ensureForOwner(user.id);
    const second = await repository.ensureForOwner(user.id);

    expect(second.id).toBe(first.id);
    expect(first.lifecycle).toBe("UNINITIALIZED");
    await expect(prisma.vault.count({ where: { ownerId: user.id, type: "PERSONAL" } })).resolves.toBe(1);
  });

  it.skipIf(!process.env.DATABASE_URL)(
    "atomically stores the initial encrypted ECDH identity with the Personal Vault",
    async () => {
      const user = await prisma.applicationUser.create({
        data: { email: `${randomUUID()}@example.test` },
      });
      userIds.push(user.id);
      const repository = new PrismaPersonalVaultRepository(prisma);
      const vault = await repository.ensureForOwner(user.id);
      const encryptedUserPrivateKey = Uint8Array.from({ length: 61 }, (_, index) => index + 1);
      const publicKey = {
        kty: "EC",
        crv: "P-256",
        x: "A".repeat(43),
        y: "A".repeat(43),
        ext: true,
        key_ops: [],
      };

      await repository.initialize(user.id, {
        vaultUnlockSalt: new Uint8Array(16).fill(1),
        wrappedUserRootKey: new Uint8Array(61).fill(2),
        encryptedPersonalVaultKey: new Uint8Array(61).fill(3),
        encryptedVaultName: new Uint8Array(61).fill(4),
        userEncryptionPublicKey: publicKey,
        encryptedUserPrivateKey,
        userEncryptionKeyVersion: 1,
        encryptionVersion: 1,
      });

      const [profile, initializedVault] = await Promise.all([
        prisma.userCryptoProfile.findUnique({ where: { userId: user.id } }),
        prisma.vault.findUnique({ where: { id: vault.id } }),
      ]);
      expect(profile?.userEncryptionPublicKey).toEqual(publicKey);
      expect(profile?.encryptedUserPrivateKey).toEqual(encryptedUserPrivateKey);
      expect(profile?.userEncryptionKeyVersion).toBe(1);
      expect(initializedVault?.lifecycle).toBe("ACTIVE");
    },
  );
});
