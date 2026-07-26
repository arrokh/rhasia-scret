import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaVaultAuditRepository } from "@/modules/vault-management/infrastructure/prisma-vault-audit-repository";
import { prisma } from "@/shared/infrastructure/prisma-client";

const userIds: string[] = [];
const vaultIds: string[] = [];

afterEach(async () => {
  await prisma.vaultAuditEvent.deleteMany({ where: { vaultId: { in: vaultIds } } });
  await prisma.authenticatorAccount.deleteMany({ where: { vaultId: { in: vaultIds } } });
  await prisma.vaultMember.deleteMany({ where: { vaultId: { in: vaultIds } } });
  await prisma.vault.deleteMany({ where: { id: { in: vaultIds.splice(0) } } });
  await prisma.applicationUser.deleteMany({ where: { id: { in: userIds.splice(0) } } });
  await prisma.$disconnect();
});

describe("PrismaVaultAuditRepository", () => {
  it.skipIf(!process.env.DATABASE_URL)("records account access only for active Shared Vault members and reveals it only to the owner", async () => {
    const users = await Promise.all(["owner", "viewer", "outsider"].map(async (name) => {
      const user = await prisma.applicationUser.create({ data: { supabaseUserId: randomUUID(), email: `${name}-${randomUUID()}@example.test` } });
      userIds.push(user.id); return user;
    }));
    const [owner, viewer, outsider] = users as [typeof users[number], typeof users[number], typeof users[number]];
    const vault = await prisma.vault.create({ data: { ownerId: owner.id, type: "SHARED", lifecycle: "ACTIVE", encryptedName: bytes("name"), encryptionVersion: 1, members: { create: [{ userId: owner.id, role: "OWNER" }, { userId: viewer.id, role: "VIEWER" }] }, accounts: { create: { encryptedPayload: bytes("account"), encryptionVersion: 1 } } }, include: { accounts: true } });
    vaultIds.push(vault.id);
    const account = vault.accounts[0]!;
    const repository = new PrismaVaultAuditRepository();

    await expect(repository.recordAccountAccess(viewer.id, vault.id, account.id)).resolves.toBe(true);
    await expect(repository.recordAccountAccess(outsider.id, vault.id, account.id)).resolves.toBe(false);
    await expect(repository.listForOwner(viewer.id, vault.id)).resolves.toBeNull();
    await expect(repository.listForOwner(owner.id, vault.id)).resolves.toEqual([
      expect.objectContaining({ eventType: "ACCOUNT_ACCESSED", targetId: account.id, actorUserId: viewer.id, actorEmail: viewer.email })
    ]);
    await expect(repository.listForOwner(owner.id, vault.id, { accountId: account.id, actorUserId: viewer.id })).resolves.toHaveLength(1);
    await expect(repository.listForOwner(owner.id, vault.id, { accountId: "different-account" })).resolves.toEqual([]);
    await expect(repository.listForOwner(owner.id, vault.id, { actorUserId: outsider.id })).resolves.toEqual([]);

    await prisma.vault.update({ where: { id: vault.id }, data: { lifecycle: "DELETED", deletedAt: new Date(), purgeAfter: new Date(Date.now() + 86_400_000) } });
    await expect(repository.listForOwner(owner.id, vault.id)).resolves.toBeNull();
    await expect(repository.recordAccountAccess(viewer.id, vault.id, account.id)).resolves.toBe(false);
  });
});

function bytes(value: string) { return new TextEncoder().encode(value); }
