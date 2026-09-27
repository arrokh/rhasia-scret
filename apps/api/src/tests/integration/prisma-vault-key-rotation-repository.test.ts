import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaVaultKeyRotationRepository } from "@api/modules/vault-management/infrastructure/prisma-vault-key-rotation-repository";
import { prisma } from "@api/tests/integration/prisma";

const userIds: string[] = [];
const vaultIds: string[] = [];
const publicKey = { kty: "EC", crv: "P-256", x: "A".repeat(43), y: "B".repeat(43) } satisfies JsonWebKey;
const secondPublicKey = { ...publicKey, x: "C".repeat(43) };

afterEach(async () => {
  await prisma.vaultAuditEvent.deleteMany({ where: { vaultId: { in: vaultIds } } });
  await prisma.authenticatorAccount.deleteMany({ where: { vaultId: { in: vaultIds } } });
  await prisma.vaultInvitation.deleteMany({ where: { vaultId: { in: vaultIds } } });
  await prisma.vaultMember.deleteMany({ where: { vaultId: { in: vaultIds } } });
  await prisma.vault.deleteMany({ where: { id: { in: vaultIds.splice(0) } } });
  await prisma.applicationUser.deleteMany({ where: { id: { in: userIds.splice(0) } } });
  await prisma.$disconnect();
});

describe("PrismaVaultKeyRotationRepository", () => {
  it.skipIf(!process.env.DATABASE_URL)(
    "snapshots and atomically rotates the encrypted Vault, retained accounts, member packages, invitations, and audit",
    async () => {
      const owner = await user("owner", publicKey);
      const member = await user("member", secondPublicKey);
      const vault = await createVault(owner.id, [
        { userId: owner.id, role: "OWNER", encryptedVaultKey: bytes("owner-key"), keyVersion: 1 },
        { userId: member.id, role: "VIEWER", encryptedVaultKey: bytes("member-key"), keyVersion: 1 },
      ]);
      const activeAccount = await prisma.authenticatorAccount.create({
        data: { vaultId: vault.id, encryptedPayload: bytes("active-account"), encryptionVersion: 1 },
      });
      const recoverableAccount = await prisma.authenticatorAccount.create({
        data: {
          vaultId: vault.id,
          encryptedPayload: bytes("recoverable-account"),
          encryptionVersion: 1,
          deletedAt: new Date(Date.now() - 60_000),
        },
      });
      const expiredAccount = await prisma.authenticatorAccount.create({
        data: {
          vaultId: vault.id,
          encryptedPayload: bytes("expired-account"),
          encryptionVersion: 1,
          deletedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1_000),
        },
      });
      const pendingInvitation = await prisma.vaultInvitation.create({
        data: {
          vaultId: vault.id,
          linkVerifier: bytes("pending-link-verifier"),
          encryptedPackage: bytes("pending-package"),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      const repository = new PrismaVaultKeyRotationRepository(prisma);
      const snapshot = await repository.snapshot(owner.id, vault.id);

      expect(snapshot).not.toBeNull();
      if (!snapshot) throw new Error("Expected an active Shared Vault rotation snapshot.");
      expect(snapshot.currentKeyVersion).toBe(1);
      expect(snapshot.pendingInvitationCount).toBe(1);
      expect(snapshot.accounts.map(({ id }) => id).sort()).toEqual([activeAccount.id, recoverableAccount.id].sort());
      expect(snapshot.members.map(({ userId }) => userId).sort()).toEqual([owner.id, member.id].sort());
      expect(
        snapshot.members
          .map(({ publicKey: value }) => value)
          .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
      ).toEqual(
        [publicKey, secondPublicKey].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
      );

      const rotated = await repository.rotate(owner.id, vault.id, {
        expectedEncryptedName: snapshot.encryptedName,
        encryptedName: bytes("rotated-name"),
        encryptionVersion: 2,
        expectedKeyVersion: 1,
        keyVersion: 2,
        accounts: snapshot.accounts.map(({ id, revision }) => ({
          id,
          revision,
          encryptedPayload: bytes(`rotated-${id}`),
        })),
        memberPackages: snapshot.members.map(({ userId, publicKey: expectedPublicKey }) => {
          if (!expectedPublicKey) throw new Error(`Missing encryption public key for ${userId}.`);
          return {
            userId,
            expectedPublicKey,
            encryptedVaultKey: bytes(`rotated-key-${userId}`),
          };
        }),
      });

      expect(rotated).toBe(true);
      await expect(
        prisma.vault.findUnique({
          where: { id: vault.id },
          select: { encryptedName: true, encryptionVersion: true },
        }),
      ).resolves.toEqual({ encryptedName: bytes("rotated-name"), encryptionVersion: 2 });
      await expect(
        prisma.vaultMember.findMany({
          where: { vaultId: vault.id },
          orderBy: { userId: "asc" },
          select: { userId: true, encryptedVaultKey: true, keyVersion: true },
        }),
      ).resolves.toEqual(
        [owner.id, member.id].sort().map((userId) => ({
          userId,
          encryptedVaultKey: bytes(`rotated-key-${userId}`),
          keyVersion: 2,
        })),
      );
      await expect(
        prisma.authenticatorAccount.findMany({
          where: { id: { in: [activeAccount.id, recoverableAccount.id, expiredAccount.id] } },
          orderBy: { id: "asc" },
          select: { id: true, encryptedPayload: true, revision: true },
        }),
      ).resolves.toEqual(
        [
          { id: activeAccount.id, encryptedPayload: bytes(`rotated-${activeAccount.id}`), revision: 2 },
          { id: recoverableAccount.id, encryptedPayload: bytes(`rotated-${recoverableAccount.id}`), revision: 2 },
          { id: expiredAccount.id, encryptedPayload: bytes("expired-account"), revision: 1 },
        ].sort((left, right) => left.id.localeCompare(right.id)),
      );
      await expect(prisma.vaultInvitation.findUnique({ where: { id: pendingInvitation.id } })).resolves.toBeNull();
      await expect(
        prisma.vaultAuditEvent.findMany({
          where: { vaultId: vault.id },
          select: { eventType: true, ownerId: true, actorUserId: true, targetId: true },
        }),
      ).resolves.toEqual([
        { eventType: "VAULT_KEY_ROTATED", ownerId: owner.id, actorUserId: owner.id, targetId: null },
      ]);
    },
  );

  it.skipIf(!process.env.DATABASE_URL)(
    "rejects stale snapshots without partially changing persisted ciphertext",
    async () => {
      const owner = await user("owner", publicKey);
      const member = await user("member", secondPublicKey);
      const vault = await createVault(owner.id, [
        { userId: owner.id, role: "OWNER", encryptedVaultKey: bytes("owner-key"), keyVersion: 1 },
        { userId: member.id, role: "VIEWER", encryptedVaultKey: bytes("member-key"), keyVersion: 1 },
      ]);
      const account = await prisma.authenticatorAccount.create({
        data: { vaultId: vault.id, encryptedPayload: bytes("original-account"), encryptionVersion: 1 },
      });
      const repository = new PrismaVaultKeyRotationRepository(prisma);
      const snapshot = await repository.snapshot(owner.id, vault.id);
      expect(snapshot).not.toBeNull();
      if (!snapshot) throw new Error("Expected an active Shared Vault rotation snapshot.");
      await prisma.authenticatorAccount.update({
        where: { id: account.id },
        data: { encryptedPayload: bytes("newer-account"), revision: { increment: 1 } },
      });

      await expect(repository.rotate(owner.id, vault.id, rotationFrom(snapshot))).resolves.toBe(false);
      await expect(
        prisma.vault.findUnique({ where: { id: vault.id }, select: { encryptedName: true, encryptionVersion: true } }),
      ).resolves.toEqual({ encryptedName: bytes("vault-name"), encryptionVersion: 1 });
      await expect(
        prisma.authenticatorAccount.findUnique({
          where: { id: account.id },
          select: { encryptedPayload: true, revision: true },
        }),
      ).resolves.toEqual({ encryptedPayload: bytes("newer-account"), revision: 2 });
      await expect(prisma.vaultAuditEvent.count({ where: { vaultId: vault.id } })).resolves.toBe(0);
    },
  );

  it.skipIf(!process.env.DATABASE_URL)("rejects membership and account-set changes after a snapshot", async () => {
    const owner = await user("owner", publicKey);
    const member = await user("member", secondPublicKey);
    const vault = await createVault(owner.id, [
      { userId: owner.id, role: "OWNER", encryptedVaultKey: bytes("owner-key"), keyVersion: 1 },
    ]);
    const repository = new PrismaVaultKeyRotationRepository(prisma);
    const membershipSnapshot = await repository.snapshot(owner.id, vault.id);
    expect(membershipSnapshot).not.toBeNull();
    if (!membershipSnapshot) throw new Error("Expected an active Shared Vault rotation snapshot.");
    await prisma.vaultMember.create({
      data: {
        vaultId: vault.id,
        userId: member.id,
        role: "VIEWER",
        encryptedVaultKey: bytes("member-key"),
        keyVersion: 1,
      },
    });
    await expect(repository.rotate(owner.id, vault.id, rotationFrom(membershipSnapshot))).resolves.toBe(false);

    const account = await prisma.authenticatorAccount.create({
      data: { vaultId: vault.id, encryptedPayload: bytes("before-snapshot"), encryptionVersion: 1 },
    });
    const accountSnapshot = await repository.snapshot(owner.id, vault.id);
    expect(accountSnapshot).not.toBeNull();
    if (!accountSnapshot) throw new Error("Expected an active Shared Vault rotation snapshot.");
    await prisma.authenticatorAccount.create({
      data: { vaultId: vault.id, encryptedPayload: bytes("added-after-snapshot"), encryptionVersion: 1 },
    });
    await expect(repository.rotate(owner.id, vault.id, rotationFrom(accountSnapshot))).resolves.toBe(false);
    await expect(
      prisma.authenticatorAccount.findUnique({ where: { id: account.id }, select: { revision: true } }),
    ).resolves.toEqual({ revision: 1 });
    await expect(
      prisma.vault.findUnique({ where: { id: vault.id }, select: { encryptedName: true, encryptionVersion: true } }),
    ).resolves.toEqual({ encryptedName: bytes("vault-name"), encryptionVersion: 1 });
    await expect(prisma.vaultAuditEvent.count({ where: { vaultId: vault.id } })).resolves.toBe(0);
  });

  it.skipIf(!process.env.DATABASE_URL)("serializes concurrent rotations from the same snapshot", async () => {
    const owner = await user("owner", publicKey);
    const vault = await createVault(owner.id, [
      { userId: owner.id, role: "OWNER", encryptedVaultKey: bytes("owner-key"), keyVersion: 1 },
    ]);
    const repository = new PrismaVaultKeyRotationRepository(prisma);
    const snapshot = await repository.snapshot(owner.id, vault.id);
    expect(snapshot).not.toBeNull();
    if (!snapshot) throw new Error("Expected an active Shared Vault rotation snapshot.");
    const rotation = rotationFrom(snapshot);

    const results = await Promise.all([
      repository.rotate(owner.id, vault.id, rotation),
      repository.rotate(owner.id, vault.id, rotation),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((result) => !result)).toHaveLength(1);
    await expect(
      prisma.vaultMember.findUnique({
        where: { vaultId_userId: { vaultId: vault.id, userId: owner.id } },
        select: { keyVersion: true },
      }),
    ).resolves.toEqual({ keyVersion: 2 });
    await expect(prisma.vaultAuditEvent.count({ where: { vaultId: vault.id } })).resolves.toBe(1);
  });
});

function rotationFrom(snapshot: NonNullable<Awaited<ReturnType<PrismaVaultKeyRotationRepository["snapshot"]>>>) {
  return {
    expectedEncryptedName: snapshot.encryptedName,
    encryptedName: bytes("rotated-name"),
    encryptionVersion: 2,
    expectedKeyVersion: 1,
    keyVersion: 2,
    accounts: snapshot.accounts.map(({ id, revision }) => ({ id, revision, encryptedPayload: bytes(`rotated-${id}`) })),
    memberPackages: snapshot.members.map(({ userId, publicKey: expectedPublicKey }) => {
      if (!expectedPublicKey) throw new Error(`Missing encryption public key for ${userId}.`);
      return { userId, expectedPublicKey, encryptedVaultKey: bytes(`rotated-key-${userId}`) };
    }),
  };
}

async function createVault(
  ownerId: string,
  members: Array<{
    userId: string;
    role: string;
    encryptedVaultKey: Uint8Array<ArrayBuffer>;
    keyVersion: number;
  }>,
) {
  const vault = await prisma.vault.create({
    data: {
      ownerId,
      type: "SHARED",
      lifecycle: "ACTIVE",
      encryptedName: bytes("vault-name"),
      encryptionVersion: 1,
      members: {
        create: members.map(({ userId, ...member }) => ({
          ...member,
          user: { connect: { id: userId } },
        })),
      },
    },
  });
  vaultIds.push(vault.id);
  return vault;
}

async function user(label: string, userPublicKey: JsonWebKey) {
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
      userEncryptionPublicKey: userPublicKey as Prisma.InputJsonValue,
      encryptedUserPrivateKey: bytes("synthetic-encrypted-private-key"),
      userEncryptionKeyVersion: 1,
    },
  });
  return user;
}

function bytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(new TextEncoder().encode(value.padEnd(32, "x")));
}
