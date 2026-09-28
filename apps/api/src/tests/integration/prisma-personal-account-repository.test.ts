import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaPersonalAccountRepository } from "@api/modules/authenticator-account/infrastructure/prisma-personal-account-repository";
import type { EncryptedPayloadMigration } from "@api/shared/application/encrypted-payload-migration";
import { sha256Digest, toBase64Url } from "@api/shared/infrastructure/crypto";
import { prisma } from "@api/tests/integration/prisma";

const userIds: string[] = [];
const vaultIds: string[] = [];

afterEach(async () => {
  await prisma.vaultAuditEvent.deleteMany({ where: { vaultId: { in: vaultIds } } });
  await prisma.authenticatorAccount.deleteMany({ where: { vaultId: { in: vaultIds } } });
  await prisma.vault.deleteMany({ where: { id: { in: vaultIds.splice(0) } } });
  await prisma.applicationUser.deleteMany({ where: { id: { in: userIds.splice(0) } } });
  await prisma.$disconnect();
});

describe("PrismaPersonalAccountRepository recovery", () => {
  it.skipIf(!process.env.DATABASE_URL)(
    "atomically audits accounts copied from Local Vault without local identifiers",
    async () => {
      const user = await prisma.applicationUser.create({
        data: { email: `${randomUUID()}@example.test` },
      });
      userIds.push(user.id);
      const vault = await prisma.vault.create({
        data: {
          ownerId: user.id,
          type: "PERSONAL",
          lifecycle: "ACTIVE",
          encryptedName: Uint8Array.of(1),
          encryptionVersion: 1,
        },
      });
      vaultIds.push(vault.id);

      const account = await new PrismaPersonalAccountRepository(prisma).create(user.id, vault.id, {
        encryptedPayload: Uint8Array.of(1, 2, 3),
        encryptionVersion: 1,
        source: "LOCAL_VAULT_COPY",
      });

      await expect(
        prisma.vaultAuditEvent.findMany({
          where: { vaultId: vault.id },
          select: { eventType: true, targetId: true, actorUserId: true },
        }),
      ).resolves.toEqual([{ eventType: "ACCOUNT_COPIED_FROM_LOCAL", targetId: account.id, actorUserId: user.id }]);
    },
  );

  it.skipIf(!process.env.DATABASE_URL)(
    "atomically replaces only legacy account ciphertext and recognizes the exact retry",
    async () => {
      const user = await prisma.applicationUser.create({ data: { email: `${randomUUID()}@example.test` } });
      userIds.push(user.id);
      const vault = await prisma.vault.create({
        data: {
          ownerId: user.id,
          type: "PERSONAL",
          lifecycle: "ACTIVE",
          encryptedName: Uint8Array.of(1),
          encryptionVersion: 1,
        },
      });
      vaultIds.push(vault.id);
      const source = Uint8Array.from([1, 2, 3, 4]);
      const replacement = Uint8Array.from([2, ...new Array<number>(40).fill(7)]);
      const account = await prisma.authenticatorAccount.create({
        data: { vaultId: vault.id, encryptedPayload: source, encryptionVersion: 1 },
      });
      const migration = encryptedMigration(source, replacement);
      const repository = new PrismaPersonalAccountRepository(prisma);

      await expect(repository.migratePayload(user.id, vault.id, account.id, 1, 1, migration)).resolves.toBe(
        "committed",
      );
      await expect(repository.migratePayload(user.id, vault.id, account.id, 1, 1, migration)).resolves.toBe(
        "already-committed",
      );
      await expect(
        prisma.authenticatorAccount.findUnique({
          where: { id: account.id },
          select: { encryptedPayload: true, revision: true },
        }),
      ).resolves.toEqual({ encryptedPayload: replacement, revision: 1 });

      const staleReplacement = Uint8Array.from([2, ...new Array<number>(40).fill(8)]);
      const staleMigration = encryptedMigration(source, staleReplacement);
      await expect(repository.migratePayload(user.id, vault.id, account.id, 1, 1, staleMigration)).resolves.toBe(
        "conflict",
      );
      await expect(
        prisma.authenticatorAccount.findUnique({ where: { id: account.id }, select: { encryptedPayload: true } }),
      ).resolves.toEqual({ encryptedPayload: replacement });
      source.fill(0);
      replacement.fill(0);
      staleReplacement.fill(0);
    },
  );

  it.skipIf(!process.env.DATABASE_URL)(
    "restores before the 30-day deadline, advances revision, and rejects expiry",
    async () => {
      const user = await prisma.applicationUser.create({
        data: { email: `${randomUUID()}@example.test` },
      });
      userIds.push(user.id);
      const vault = await prisma.vault.create({
        data: {
          ownerId: user.id,
          type: "PERSONAL",
          lifecycle: "ACTIVE",
          encryptedName: Uint8Array.of(1),
          encryptionVersion: 1,
        },
      });
      vaultIds.push(vault.id);
      const account = await prisma.authenticatorAccount.create({
        data: { vaultId: vault.id, encryptedPayload: Uint8Array.of(1, 2, 3), encryptionVersion: 1 },
      });
      const deletedAt = new Date("2026-07-27T00:00:00.000Z");

      await expect(
        new PrismaPersonalAccountRepository(prisma, () => deletedAt).delete(user.id, vault.id, account.id, 1),
      ).resolves.toBe(true);
      await expect(
        new PrismaPersonalAccountRepository(prisma, () => new Date("2026-08-25T23:59:59.999Z")).restore(
          user.id,
          vault.id,
          account.id,
        ),
      ).resolves.toBe(true);
      await expect(
        prisma.authenticatorAccount.findUnique({
          where: { id: account.id },
          select: { revision: true, deletedAt: true, purgeAfter: true },
        }),
      ).resolves.toEqual({ revision: 3, deletedAt: null, purgeAfter: null });

      await expect(
        new PrismaPersonalAccountRepository(prisma, () => deletedAt).delete(user.id, vault.id, account.id, 3),
      ).resolves.toBe(true);
      await expect(
        new PrismaPersonalAccountRepository(prisma, () => new Date("2026-08-26T00:00:00.000Z")).restore(
          user.id,
          vault.id,
          account.id,
        ),
      ).resolves.toBe(false);
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
