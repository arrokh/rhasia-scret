import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaEncryptedVaultImportRepository } from "@/modules/vault-archive/infrastructure/prisma-encrypted-vault-import-repository";
import { prisma } from "@/shared/infrastructure/prisma-client";

const userIds: string[] = [];
const vaultIds: string[] = [];

async function cleanup() {
  await prisma.vaultAuditEvent.deleteMany({ where: { vaultId: { in: vaultIds } } });
  await prisma.authenticatorAccount.deleteMany({ where: { vaultId: { in: vaultIds } } });
  await prisma.vaultInvitation.deleteMany({ where: { vaultId: { in: vaultIds } } });
  await prisma.vaultMember.deleteMany({ where: { vaultId: { in: vaultIds } } });
  await prisma.vault.deleteMany({ where: { id: { in: vaultIds } } });
  await prisma.applicationUser.deleteMany({ where: { id: { in: userIds } } });
  userIds.length = 0;
  vaultIds.length = 0;
}

afterEach(cleanup);

describe("PrismaEncryptedVaultImportRepository", () => {
  it.skipIf(!process.env.DATABASE_URL)("atomically imports all ciphertext accounts into an owned existing destination and replays safely", async () => {
    const owner = await createUser("existing-owner");
    const vault = await createVault(owner.id, "PERSONAL");
    const accountIds = [randomUUID(), randomUUID()];
    const request = {
      destination: { kind: "EXISTING" as const, vaultId: vault.id, vaultType: "PERSONAL" as const },
      accounts: accountIds.map((id) => ({ id, encryptedPayload: bytes(`ciphertext-${id}`), encryptionVersion: 1 as const }))
    };
    const repository = new PrismaEncryptedVaultImportRepository();

    await expect(repository.import(owner.id, request)).resolves.toEqual({ status: "IMPORTED", vaultId: vault.id, accountIds, vaultCreated: false });
    await expect(repository.import(owner.id, request)).resolves.toEqual({ status: "REPLAYED", vaultId: vault.id, accountIds, vaultCreated: false });
    expect(await prisma.authenticatorAccount.count({ where: { vaultId: vault.id } })).toBe(2);
    expect(await prisma.vaultAuditEvent.findMany({ where: { vaultId: vault.id }, select: { eventType: true, targetId: true } })).toEqual([{ eventType: "ARCHIVE_IMPORTED", targetId: null }]);
  });

  it.skipIf(!process.env.DATABASE_URL)("imports into an existing owned Shared Vault with one redacted audit event", async () => {
    const owner = await createUser("shared-owner");
    const vault = await createVault(owner.id, "SHARED");
    const accountId = randomUUID();
    const request = {
      destination: { kind: "EXISTING" as const, vaultId: vault.id, vaultType: "SHARED" as const },
      accounts: [{ id: accountId, encryptedPayload: bytes("encrypted-account"), encryptionVersion: 1 as const }]
    };
    await expect(new PrismaEncryptedVaultImportRepository().import(owner.id, request)).resolves.toEqual({ status: "IMPORTED", vaultId: vault.id, accountIds: [accountId], vaultCreated: false });
    expect(await prisma.vaultAuditEvent.findMany({ where: { vaultId: vault.id }, select: { eventType: true, targetId: true } })).toEqual([{ eventType: "ARCHIVE_IMPORTED", targetId: null }]);
  });

  it.skipIf(!process.env.DATABASE_URL)("creates a Shared Vault, owner key, all accounts, and redacted audit event in one transaction", async () => {
    const owner = await createUser("new-owner");
    const vaultId = randomUUID();
    vaultIds.push(vaultId);
    const accountIds = [randomUUID(), randomUUID()];
    const request = {
      destination: { kind: "NEW_SHARED" as const, vaultId, encryptedName: bytes("encrypted-name"), encryptedOwnerVaultKey: bytes("encrypted-owner-key"), encryptionVersion: 1 as const },
      accounts: accountIds.map((id) => ({ id, encryptedPayload: bytes("encrypted-account"), encryptionVersion: 1 as const }))
    };

    await expect(new PrismaEncryptedVaultImportRepository().import(owner.id, request)).resolves.toEqual({ status: "IMPORTED", vaultId, accountIds, vaultCreated: true });
    expect(await prisma.vault.findUnique({ where: { id: vaultId }, select: { ownerId: true, type: true, members: { select: { userId: true, role: true, encryptedVaultKey: true } }, accounts: { select: { id: true } } } })).toEqual({
      ownerId: owner.id,
      type: "SHARED",
      members: [{ userId: owner.id, role: "OWNER", encryptedVaultKey: bytes("encrypted-owner-key") }],
      accounts: expect.arrayContaining(accountIds.map((id) => ({ id })))
    });
    expect(await prisma.vaultAuditEvent.findMany({ where: { vaultId }, select: { ownerId: true, eventType: true, targetId: true } })).toEqual([{ ownerId: owner.id, eventType: "ARCHIVE_IMPORTED", targetId: null }]);
  });

  it.skipIf(!process.env.DATABASE_URL)("rejects unauthorized destinations and conflicting identifiers without partial writes", async () => {
    const owner = await createUser("authorized-owner");
    const outsider = await createUser("outsider");
    const ownerVault = await createVault(owner.id, "PERSONAL");
    const conflicting = await prisma.authenticatorAccount.create({ data: { id: randomUUID(), vaultId: ownerVault.id, encryptedPayload: bytes("existing"), encryptionVersion: 1 } });
    const repository = new PrismaEncryptedVaultImportRepository();

    await expect(repository.import(outsider.id, { destination: { kind: "EXISTING", vaultId: ownerVault.id, vaultType: "PERSONAL" }, accounts: [] })).resolves.toEqual({ status: "DESTINATION_UNAVAILABLE" });

    const newVaultId = randomUUID();
    vaultIds.push(newVaultId);
    const repeatedAccountId = randomUUID();
    const duplicateRequest = {
      destination: { kind: "NEW_SHARED" as const, vaultId: newVaultId, encryptedName: bytes("encrypted-name"), encryptedOwnerVaultKey: bytes("owner-key"), encryptionVersion: 1 as const },
      accounts: [0, 1].map(() => ({ id: repeatedAccountId, encryptedPayload: bytes("encrypted-account"), encryptionVersion: 1 as const }))
    };
    await expect(repository.import(owner.id, duplicateRequest)).resolves.toEqual({ status: "CONFLICT" });
    expect(await prisma.vault.findUnique({ where: { id: newVaultId } })).toBeNull();
    expect(await prisma.authenticatorAccount.count({ where: { id: repeatedAccountId } })).toBe(0);
    expect(await prisma.vaultAuditEvent.count({ where: { vaultId: newVaultId } })).toBe(0);
    expect(await prisma.authenticatorAccount.count({ where: { id: conflicting.id } })).toBe(1);
  });
});

async function createUser(label: string) {
  const user = await prisma.applicationUser.create({ data: { supabaseUserId: randomUUID(), email: `${label}-${randomUUID()}@example.test` } });
  userIds.push(user.id);
  return user;
}

async function createVault(ownerId: string, type: "PERSONAL" | "SHARED") {
  const vault = await prisma.vault.create({ data: { ownerId, type, lifecycle: "ACTIVE", encryptedName: bytes("encrypted-vault"), encryptionVersion: 1 } });
  vaultIds.push(vault.id);
  return vault;
}

function bytes(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value);
}
