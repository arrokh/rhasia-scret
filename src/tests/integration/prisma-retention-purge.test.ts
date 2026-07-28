import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaExpiredAccountPurgeRepository } from "@/modules/authenticator-account/infrastructure/prisma-expired-account-purge-repository";
import { PrismaSharedAccountRepository } from "@/modules/authenticator-account/infrastructure/prisma-shared-account-repository";
import { auditPurgeAfter, vaultPurgeAfter } from "@/modules/vault-management";
import { PrismaExpiredVaultRetentionRepository } from "@/modules/vault-management/infrastructure/prisma-expired-vault-retention-repository";
import { PrismaSharedVaultRecoveryRepository } from "@/modules/vault-management/infrastructure/prisma-shared-vault-recovery-repository";
import { PrismaVaultAuditRepository } from "@/modules/vault-management/infrastructure/prisma-vault-audit-repository";
import { prisma } from "@/shared/infrastructure/prisma-client";

const userIds: string[] = [];
const vaultIds: string[] = [];

afterEach(async () => {
  await prisma.vaultAuditEvent.deleteMany({ where: { vaultId: { in: vaultIds } } });
  await prisma.authenticatorAccount.deleteMany({ where: { vaultId: { in: vaultIds } } });
  await prisma.vaultInvitation.deleteMany({ where: { vaultId: { in: vaultIds } } });
  await prisma.vaultMember.deleteMany({ where: { vaultId: { in: vaultIds } } });
  await prisma.vault.deleteMany({ where: { id: { in: vaultIds.splice(0) } } });
  await prisma.applicationUser.deleteMany({ where: { id: { in: userIds.splice(0) } } });
  await prisma.$disconnect();
});

describe("Prisma retention purge", () => {
  it.skipIf(!process.env.DATABASE_URL)("purges only eligible accounts at their deadlines and is idempotent", async () => {
    const owner = await createUser("account-owner");
    const vault = await createSharedVault(owner.id);
    const now = new Date("2026-07-26T12:00:00.000Z");
    const expired = await createAccount(vault.id, new Date(now.getTime() - 1));
    const future = await createAccount(vault.id, new Date(now.getTime() + 1));
    const active = await createAccount(vault.id, null);
    const legacy = await createAccount(vault.id, null);
    await prisma.authenticatorAccount.update({ where: { id: legacy.id }, data: { deletedAt: new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000), purgeAfter: null } });
    const repository = new PrismaExpiredAccountPurgeRepository();

    const firstPurge = await repository.purgeExpired(now, 100);
    expect(firstPurge.purgedIds).toEqual(expect.arrayContaining([expired.id, legacy.id]));
    expect(await prisma.authenticatorAccount.findMany({ where: { id: { in: [expired.id, future.id, active.id, legacy.id] } }, select: { id: true } })).toEqual(expect.arrayContaining([{ id: future.id }, { id: active.id }]));
    const repeated = await repository.purgeExpired(now, 100);
    expect(repeated.purgedIds).not.toContain(expired.id);
    expect(repeated.purgedIds).not.toContain(legacy.id);
  });

  it.skipIf(!process.env.DATABASE_URL)("sets and clears account deadlines through delete and restore", async () => {
    const owner = await createUser("restore-owner");
    const vault = await createSharedVault(owner.id);
    const account = await createAccount(vault.id, null);
    const deletedAt = new Date("2026-07-26T12:00:00.000Z");
    const repository = new PrismaSharedAccountRepository(() => deletedAt);

    await expect(repository.delete(owner.id, vault.id, account.id, 1)).resolves.toEqual({ status: "SUCCESS", value: undefined });
    expect(await prisma.authenticatorAccount.findUnique({ where: { id: account.id }, select: { deletedAt: true, purgeAfter: true } })).toEqual({ deletedAt, purgeAfter: new Date("2026-08-25T12:00:00.000Z") });
    await expect(new PrismaSharedAccountRepository(() => new Date("2026-08-25T11:59:59.999Z")).restore(owner.id, vault.id, account.id)).resolves.toEqual({ status: "SUCCESS", value: undefined });
    expect(await prisma.authenticatorAccount.findUnique({ where: { id: account.id }, select: { deletedAt: true, purgeAfter: true, revision: true } })).toEqual({ deletedAt: null, purgeAfter: null, revision: 3 });
  });

  it.skipIf(!process.env.DATABASE_URL)("purges migrated legacy Shared Vault deletions whose explicit deadline was not yet stored", async () => {
    const owner = await createUser("legacy-vault-owner");
    const vault = await createSharedVault(owner.id);
    const now = new Date("2026-07-26T12:00:00.000Z");
    const deletedAt = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);
    await prisma.vault.update({ where: { id: vault.id }, data: { lifecycle: "DELETED", deletedAt, purgeAfter: null } });
    await prisma.vaultAuditEvent.create({ data: { vaultId: vault.id, actorUserId: owner.id, eventType: "VAULT_DELETED" } });

    const legacyPurge = await new PrismaExpiredVaultRetentionRepository().purgeExpiredVaults(now, 100);
    expect(legacyPurge.purgedIds).toContain(vault.id);
    expect(await prisma.vault.findUnique({ where: { id: vault.id } })).toBeNull();
    const retained = await prisma.vaultAuditEvent.findFirstOrThrow({ where: { vaultId: vault.id } });
    expect(retained.ownerId).toBe(owner.id);
    expect(retained.retentionPurgeAfter).toEqual(auditPurgeAfter(deletedAt));
  });

  it.skipIf(!process.env.DATABASE_URL)("purges expired Shared Vault content while retaining owner-only audit history for one year", async () => {
    const owner = await createUser("vault-owner");
    const viewer = await createUser("vault-viewer");
    const vault = await createSharedVault(owner.id, viewer.id);
    const account = await createAccount(vault.id, null);
    const invitation = await prisma.vaultInvitation.create({ data: { vaultId: vault.id, recipientEmail: `${randomUUID()}@example.test`, linkVerifier: bytes(randomUUID()), encryptedPackage: bytes("encrypted-package") } });
    await new PrismaVaultAuditRepository().recordAccountAccess(viewer.id, vault.id, account.id);
    const deletedAt = new Date("2026-07-26T12:00:00.000Z");
    await expect(new PrismaSharedVaultRecoveryRepository(() => deletedAt).delete(owner.id, vault.id)).resolves.toBe(true);

    const stored = await prisma.vault.findUniqueOrThrow({ where: { id: vault.id }, select: { deletedAt: true, purgeAfter: true } });
    expect(stored).toEqual({ deletedAt, purgeAfter: new Date("2026-08-25T12:00:00.000Z") });
    await expect(new PrismaVaultAuditRepository(() => new Date("2026-08-01T00:00:00.000Z")).listForOwner(owner.id, vault.id)).resolves.toEqual(expect.objectContaining({ items: expect.arrayContaining([expect.objectContaining({ eventType: "VAULT_DELETED" }), expect.objectContaining({ eventType: "ACCOUNT_ACCESSED" })]) }));
    await expect(new PrismaVaultAuditRepository().listForOwner(viewer.id, vault.id)).resolves.toBeNull();

    const retention = new PrismaExpiredVaultRetentionRepository();
    const beforeDeadline = await retention.purgeExpiredVaults(new Date("2026-08-25T11:59:59.999Z"), 100);
    expect(beforeDeadline.purgedIds).not.toContain(vault.id);
    expect(await prisma.authenticatorAccount.count({ where: { vaultId: vault.id } })).toBe(1);
    const atDeadline = await retention.purgeExpiredVaults(new Date("2026-08-25T12:00:00.000Z"), 100);
    expect(atDeadline.purgedIds).toContain(vault.id);
    expect(await prisma.vault.findUnique({ where: { id: vault.id } })).toBeNull();
    expect(await prisma.authenticatorAccount.findUnique({ where: { id: account.id } })).toBeNull();
    expect(await prisma.vaultMember.count({ where: { vaultId: vault.id } })).toBe(0);
    expect(await prisma.vaultInvitation.findUnique({ where: { id: invitation.id } })).toBeNull();
    const retainedAuditPage = await new PrismaVaultAuditRepository(() => new Date("2027-07-26T11:59:59.999Z")).listForOwner(owner.id, vault.id);
    expect(retainedAuditPage?.items).toHaveLength(2);
    await expect(new PrismaVaultAuditRepository().listForOwner(viewer.id, vault.id)).resolves.toBeNull();

    const ownAuditIds = (await prisma.vaultAuditEvent.findMany({ where: { vaultId: vault.id }, select: { id: true } })).map(({ id }) => id);
    const auditBeforeDeadline = await retention.purgeExpiredAuditEvents(new Date("2027-07-26T11:59:59.999Z"), 100);
    expect(ownAuditIds.every((id) => !auditBeforeDeadline.purgedIds.includes(id))).toBe(true);
    const purgedAudit = await retention.purgeExpiredAuditEvents(new Date("2027-07-26T12:00:00.000Z"), 100);
    expect(purgedAudit.purgedIds).toEqual(expect.arrayContaining(ownAuditIds));
    const repeatedAuditPurge = await retention.purgeExpiredAuditEvents(new Date("2027-07-26T12:00:00.000Z"), 100);
    expect(ownAuditIds.every((id) => !repeatedAuditPurge.purgedIds.includes(id))).toBe(true);
    await expect(new PrismaVaultAuditRepository(() => new Date("2027-07-26T12:00:00.000Z")).listForOwner(owner.id, vault.id)).resolves.toBeNull();
  });

  it.skipIf(!process.env.DATABASE_URL)("never purges a Shared Vault or account that wins a concurrent restore", async () => {
    const owner = await createUser("race-owner");
    const vault = await createSharedVault(owner.id);
    const account = await createAccount(vault.id, null);
    const deletedAt = new Date("2026-01-01T00:00:00.000Z");
    const deadline = vaultPurgeAfter(deletedAt);
    await prisma.authenticatorAccount.update({ where: { id: account.id }, data: { deletedAt, purgeAfter: deadline } });
    const [restoredAccount, purgedAccounts] = await Promise.all([
      new PrismaSharedAccountRepository(() => new Date(deadline.getTime() - 1)).restore(owner.id, vault.id, account.id),
      new PrismaExpiredAccountPurgeRepository().purgeExpired(new Date(deadline.getTime() + 1), 100)
    ]);
    const remainingAccount = await prisma.authenticatorAccount.findUnique({ where: { id: account.id } });
    if (restoredAccount.status === "SUCCESS") {
      expect(remainingAccount).toEqual(expect.objectContaining({ deletedAt: null, purgeAfter: null }));
      expect(purgedAccounts.purgedIds).not.toContain(account.id);
    } else {
      expect(remainingAccount).toBeNull();
      expect(purgedAccounts.purgedIds).toContain(account.id);
    }

    if (!remainingAccount) await createAccount(vault.id, null);
    await prisma.vault.update({ where: { id: vault.id }, data: { lifecycle: "DELETED", deletedAt, purgeAfter: deadline } });
    const retention = new PrismaExpiredVaultRetentionRepository();
    const [restoredVault, purgedVaults] = await Promise.all([
      new PrismaSharedVaultRecoveryRepository(() => new Date(deadline.getTime() - 1)).restore(owner.id, vault.id),
      retention.purgeExpiredVaults(new Date(deadline.getTime() + 1), 100)
    ]);
    const remainingVault = await prisma.vault.findUnique({ where: { id: vault.id } });
    if (restoredVault) {
      expect(remainingVault).toEqual(expect.objectContaining({ lifecycle: "ACTIVE", deletedAt: null, purgeAfter: null }));
      expect(purgedVaults.purgedIds).not.toContain(vault.id);
    } else {
      expect(remainingVault).toBeNull();
      expect(purgedVaults.purgedIds).toContain(vault.id);
    }
  });
});

async function createUser(label: string) {
  const user = await prisma.applicationUser.create({ data: { supabaseUserId: randomUUID(), email: `${label}-${randomUUID()}@example.test` } });
  userIds.push(user.id);
  return user;
}

async function createSharedVault(ownerId: string, viewerId?: string) {
  const vault = await prisma.vault.create({
    data: {
      ownerId,
      type: "SHARED",
      lifecycle: "ACTIVE",
      encryptedName: bytes("encrypted-name"),
      encryptionVersion: 1,
      members: { create: [{ userId: ownerId, role: "OWNER" as const, encryptedVaultKey: bytes("owner-key"), keyVersion: 1 }, ...(viewerId ? [{ userId: viewerId, role: "VIEWER" as const, encryptedVaultKey: bytes("viewer-key"), keyVersion: 1 }] : [])] }
    }
  });
  vaultIds.push(vault.id);
  return vault;
}

function createAccount(vaultId: string, purgeAfter: Date | null) {
  return prisma.authenticatorAccount.create({ data: { vaultId, encryptedPayload: bytes("encrypted-account"), encryptionVersion: 1, deletedAt: purgeAfter ? new Date(purgeAfter.getTime() - 30 * 24 * 60 * 60 * 1000) : null, purgeAfter } });
}

function bytes(value: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(value);
  const copy = new Uint8Array(encoded.length);
  copy.set(encoded);
  return copy;
}
