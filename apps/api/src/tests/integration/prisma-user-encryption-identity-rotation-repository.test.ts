import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaUserEncryptionIdentityRotationRepository } from "@api/modules/identity/infrastructure/prisma-user-encryption-identity-rotation-repository";
import { prisma } from "@api/tests/integration/prisma";

const userIds: string[] = [];
const vaultIds: string[] = [];
const oldPublicKey = { kty: "EC", crv: "P-256", x: "A".repeat(43), y: "B".repeat(43) } satisfies JsonWebKey;
const newPublicKey = { ...oldPublicKey, x: "C".repeat(43) };

afterEach(async () => {
  await prisma.vaultAuditEvent.deleteMany({ where: { vaultId: { in: vaultIds } } });
  await prisma.vaultMember.deleteMany({ where: { vaultId: { in: vaultIds } } });
  await prisma.vault.deleteMany({ where: { id: { in: vaultIds.splice(0) } } });
  await prisma.applicationUser.deleteMany({ where: { id: { in: userIds.splice(0) } } });
  await prisma.$disconnect();
});

describe("PrismaUserEncryptionIdentityRotationRepository", () => {
  it.skipIf(!process.env.DATABASE_URL)(
    "snapshots and atomically rewraps every active Shared Vault membership with redacted audit events",
    async () => {
      const user = await createUser("rotating-user");
      const firstOwner = await createUser("first-owner");
      const secondOwner = await createUser("second-owner");
      const firstVault = await createVault(firstOwner.id, user.id, "first");
      const secondVault = await createVault(secondOwner.id, user.id, "second");
      const repository = new PrismaUserEncryptionIdentityRotationRepository(prisma);
      const snapshot = await repository.snapshot(user.id);

      expect(snapshot).toEqual({
        publicKey: oldPublicKey,
        encryptedPrivateKey: bytes("old-encrypted-private-key"),
        encryptionVersion: 1,
        memberships: [
          {
            vaultId: firstVault.id,
            ownerId: firstOwner.id,
            encryptedVaultKey: bytes("wrapped-first"),
            keyVersion: 1,
          },
          {
            vaultId: secondVault.id,
            ownerId: secondOwner.id,
            encryptedVaultKey: bytes("wrapped-second"),
            keyVersion: 1,
          },
        ].sort((left, right) => left.vaultId.localeCompare(right.vaultId)),
      });
      if (!snapshot) throw new Error("Expected a configured user-encryption identity snapshot.");

      await expect(repository.rotate(user.id, rotationFrom(snapshot))).resolves.toBe(true);
      await expect(
        prisma.userCryptoProfile.findUnique({
          where: { userId: user.id },
          select: {
            userEncryptionPublicKey: true,
            encryptedUserPrivateKey: true,
            userEncryptionKeyVersion: true,
          },
        }),
      ).resolves.toEqual({
        userEncryptionPublicKey: newPublicKey,
        encryptedUserPrivateKey: bytes("new-encrypted-private-key"),
        userEncryptionKeyVersion: 2,
      });
      await expect(
        prisma.vaultMember.findMany({
          where: { userId: user.id },
          orderBy: { vaultId: "asc" },
          select: { vaultId: true, encryptedVaultKey: true, keyVersion: true },
        }),
      ).resolves.toEqual(
        [firstVault.id, secondVault.id]
          .sort()
          .map((vaultId) => ({ vaultId, encryptedVaultKey: bytes(`rotated-${vaultId}`), keyVersion: 1 })),
      );
      await expect(
        prisma.vaultAuditEvent.findMany({
          where: { vaultId: { in: [firstVault.id, secondVault.id] } },
          orderBy: { vaultId: "asc" },
          select: { vaultId: true, eventType: true, ownerId: true, actorUserId: true, targetId: true },
        }),
      ).resolves.toEqual(
        [
          {
            vaultId: firstVault.id,
            eventType: "USER_ENCRYPTION_KEY_PAIR_ROTATED",
            ownerId: firstOwner.id,
            actorUserId: user.id,
            targetId: null,
          },
          {
            vaultId: secondVault.id,
            eventType: "USER_ENCRYPTION_KEY_PAIR_ROTATED",
            ownerId: secondOwner.id,
            actorUserId: user.id,
            targetId: null,
          },
        ].sort((left, right) => left.vaultId.localeCompare(right.vaultId)),
      );
      const audit = await prisma.vaultAuditEvent.findMany({ where: { vaultId: { in: vaultIds } } });
      expect(JSON.stringify(audit)).not.toContain("encrypted-private-key");
      expect(JSON.stringify(audit)).not.toContain("rotated-");
    },
  );

  it.skipIf(!process.env.DATABASE_URL)(
    "rejects stale membership ciphertext without changing identity material",
    async () => {
      const user = await createUser("rotating-user");
      const owner = await createUser("owner");
      const vault = await createVault(owner.id, user.id, "stale");
      const repository = new PrismaUserEncryptionIdentityRotationRepository(prisma);
      const snapshot = await repository.snapshot(user.id);
      expect(snapshot).not.toBeNull();
      if (!snapshot) throw new Error("Expected a configured user-encryption identity snapshot.");
      await prisma.vaultMember.update({
        where: { vaultId_userId: { vaultId: vault.id, userId: user.id } },
        data: { encryptedVaultKey: bytes("newer-wrapped-key") },
      });

      await expect(repository.rotate(user.id, rotationFrom(snapshot))).resolves.toBe(false);
      await expect(
        prisma.userCryptoProfile.findUnique({
          where: { userId: user.id },
          select: { userEncryptionPublicKey: true, encryptedUserPrivateKey: true, userEncryptionKeyVersion: true },
        }),
      ).resolves.toEqual({
        userEncryptionPublicKey: oldPublicKey,
        encryptedUserPrivateKey: bytes("old-encrypted-private-key"),
        userEncryptionKeyVersion: 1,
      });
      await expect(prisma.vaultAuditEvent.count({ where: { vaultId: vault.id } })).resolves.toBe(0);
    },
  );

  it.skipIf(!process.env.DATABASE_URL)(
    "rejects a newly active membership that was absent from the snapshot",
    async () => {
      const user = await createUser("rotating-user");
      const firstOwner = await createUser("first-owner");
      const secondOwner = await createUser("second-owner");
      await createVault(firstOwner.id, user.id, "before-snapshot");
      const repository = new PrismaUserEncryptionIdentityRotationRepository(prisma);
      const snapshot = await repository.snapshot(user.id);
      expect(snapshot).not.toBeNull();
      if (!snapshot) throw new Error("Expected a configured user-encryption identity snapshot.");
      const addedVault = await createVault(secondOwner.id, user.id, "after-snapshot");

      await expect(repository.rotate(user.id, rotationFrom(snapshot))).resolves.toBe(false);
      await expect(
        prisma.userCryptoProfile.findUnique({
          where: { userId: user.id },
          select: { userEncryptionPublicKey: true, encryptedUserPrivateKey: true, userEncryptionKeyVersion: true },
        }),
      ).resolves.toEqual({
        userEncryptionPublicKey: oldPublicKey,
        encryptedUserPrivateKey: bytes("old-encrypted-private-key"),
        userEncryptionKeyVersion: 1,
      });
      await expect(
        prisma.vaultMember.findUnique({
          where: { vaultId_userId: { vaultId: addedVault.id, userId: user.id } },
          select: { encryptedVaultKey: true },
        }),
      ).resolves.toEqual({ encryptedVaultKey: bytes(`wrapped-after-snapshot`) });
      await expect(prisma.vaultAuditEvent.count({ where: { vaultId: { in: vaultIds } } })).resolves.toBe(0);
    },
  );

  it.skipIf(!process.env.DATABASE_URL)("serializes concurrent identity rotations from the same snapshot", async () => {
    const user = await createUser("rotating-user");
    const owner = await createUser("owner");
    const vault = await createVault(owner.id, user.id, "concurrent");
    const repository = new PrismaUserEncryptionIdentityRotationRepository(prisma);
    const snapshot = await repository.snapshot(user.id);
    expect(snapshot).not.toBeNull();
    if (!snapshot) throw new Error("Expected a configured user-encryption identity snapshot.");

    const results = await Promise.all([
      repository.rotate(user.id, rotationFrom(snapshot)),
      repository.rotate(user.id, rotationFrom(snapshot)),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((result) => !result)).toHaveLength(1);
    await expect(
      prisma.userCryptoProfile.findUnique({
        where: { userId: user.id },
        select: { userEncryptionKeyVersion: true },
      }),
    ).resolves.toEqual({ userEncryptionKeyVersion: 2 });
    await expect(prisma.vaultAuditEvent.count({ where: { vaultId: vault.id } })).resolves.toBe(1);
  });
});

function rotationFrom(
  snapshot: NonNullable<Awaited<ReturnType<PrismaUserEncryptionIdentityRotationRepository["snapshot"]>>>,
) {
  return {
    expectedPublicKey: snapshot.publicKey,
    expectedEncryptedPrivateKey: snapshot.encryptedPrivateKey,
    expectedEncryptionVersion: snapshot.encryptionVersion,
    publicKey: newPublicKey,
    encryptedPrivateKey: bytes("new-encrypted-private-key"),
    encryptionVersion: 2,
    memberships: snapshot.memberships.map(({ vaultId, encryptedVaultKey, keyVersion }) => ({
      vaultId,
      expectedKeyVersion: keyVersion,
      expectedEncryptedVaultKey: encryptedVaultKey,
      encryptedVaultKey: bytes(`rotated-${vaultId}`),
    })),
  };
}

async function createUser(label: string) {
  const user = await prisma.applicationUser.create({ data: { email: `${label}-${randomUUID()}@example.test` } });
  userIds.push(user.id);
  await prisma.userCryptoProfile.create({
    data: {
      userId: user.id,
      vaultUnlockSalt: bytes("synthetic-salt"),
      wrappedUserRootKey: bytes("synthetic-wrapped-root-key"),
      rootKeyWrappingVersion: 1,
      encryptedPersonalVaultKey: bytes("synthetic-personal-vault-key"),
      personalVaultKeyEncryptionVersion: 1,
      userEncryptionPublicKey: oldPublicKey,
      encryptedUserPrivateKey: bytes("old-encrypted-private-key"),
      userEncryptionKeyVersion: 1,
    },
  });
  return user;
}

async function createVault(ownerId: string, memberId: string, label: string) {
  const vault = await prisma.vault.create({
    data: {
      ownerId,
      type: "SHARED",
      lifecycle: "ACTIVE",
      encryptedName: bytes(`vault-${label}`),
      encryptionVersion: 1,
      members: {
        create: [
          { userId: ownerId, role: "OWNER", encryptedVaultKey: bytes(`owner-key-${label}`), keyVersion: 1 },
          { userId: memberId, role: "VIEWER", encryptedVaultKey: bytes(`wrapped-${label}`), keyVersion: 1 },
        ],
      },
    },
  });
  vaultIds.push(vault.id);
  return vault;
}

function bytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(new TextEncoder().encode(value.padEnd(32, "x")));
}
