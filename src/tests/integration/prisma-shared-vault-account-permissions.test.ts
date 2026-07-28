import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaSharedAccountRepository } from "@/modules/authenticator-account/infrastructure/prisma-shared-account-repository";
import { PrismaMembershipLifecycleRepository } from "@/modules/vault-membership/infrastructure/prisma-membership-lifecycle-repository";
import { PrismaSharedVaultAccountPermissionRepository } from "@/modules/vault-membership/infrastructure/prisma-shared-vault-account-permission-repository";
import { prisma } from "@/shared/infrastructure/prisma-client";

const userIds: string[] = [];
const vaultIds: string[] = [];

finallyCleanup();

describe("Shared Vault account permission persistence", () => {
  it.skipIf(!process.env.DATABASE_URL)("resolves Vault defaults and independent member overrides with revision protection", async () => {
    const { owner, member, vault } = await createSharedVault();
    const repository = new PrismaSharedVaultAccountPermissionRepository();

    await expect(repository.updateVaultDefaults(owner.id, vault.id, 1, {
      canAddAccounts: true,
      canEditAccounts: false,
      canDeleteAccounts: true
    })).resolves.toEqual({
      status: "UPDATED",
      value: {
        permissions: { canAddAccounts: true, canEditAccounts: false, canDeleteAccounts: true },
        revision: 2
      }
    });
    await expect(repository.updateMemberOverrides(owner.id, vault.id, member.id, 1, {
      canAddAccounts: false,
      canEditAccounts: true,
      canDeleteAccounts: null
    })).resolves.toEqual({
      status: "UPDATED",
      value: {
        overrides: { canAddAccounts: false, canEditAccounts: true, canDeleteAccounts: null },
        effective: {
          permissions: { canAddAccounts: false, canEditAccounts: true, canDeleteAccounts: true },
          sources: { canAddAccounts: "MEMBER", canEditAccounts: "MEMBER", canDeleteAccounts: "VAULT" }
        },
        revision: 2
      }
    });

    await expect(repository.updateMemberOverrides(owner.id, vault.id, member.id, 1, {
      canAddAccounts: null,
      canEditAccounts: null,
      canDeleteAccounts: null
    })).resolves.toEqual({ status: "STALE" });
    await expect(repository.updateVaultDefaults(member.id, vault.id, 2, {
      canAddAccounts: false,
      canEditAccounts: false,
      canDeleteAccounts: false
    })).resolves.toEqual({ status: "UNAVAILABLE" });

    expect(await prisma.vaultAuditEvent.findMany({
      where: { vaultId: vault.id },
      orderBy: { createdAt: "asc" },
      select: { eventType: true, actorUserId: true, targetId: true }
    })).toEqual([
      { eventType: "VAULT_MEMBER_DEFAULT_PERMISSIONS_UPDATED", actorUserId: owner.id, targetId: null },
      { eventType: "MEMBER_PERMISSIONS_UPDATED", actorUserId: owner.id, targetId: member.id }
    ]);
  });

  it.skipIf(!process.env.DATABASE_URL)("clears overrides when membership is revoked", async () => {
    const { owner, member, vault } = await createSharedVault({
      canAddAccountsOverride: true,
      canEditAccountsOverride: false,
      canDeleteAccountsOverride: true
    });
    await new PrismaMembershipLifecycleRepository().revoke(owner.id, vault.id, member.id);

    await expect(prisma.vaultMember.findUnique({
      where: { vaultId_userId: { vaultId: vault.id, userId: member.id } },
      select: {
        status: true,
        canAddAccountsOverride: true,
        canEditAccountsOverride: true,
        canDeleteAccountsOverride: true,
        permissionsRevision: true
      }
    })).resolves.toEqual({
      status: "REVOKED",
      canAddAccountsOverride: null,
      canEditAccountsOverride: null,
      canDeleteAccountsOverride: null,
      permissionsRevision: 2
    });
  });

  it.skipIf(!process.env.DATABASE_URL)("authorizes exact member capabilities, preserves owner authority, revisions, recovery, and redacted audit", async () => {
    const { owner, member, vault } = await createSharedVault({
      canAddAccountsOverride: null,
      canEditAccountsOverride: true,
      canDeleteAccountsOverride: false
    }, {
      membersCanAddAccounts: true,
      membersCanEditAccounts: false,
      membersCanDeleteAccounts: true
    });
    const now = new Date("2026-07-28T00:00:00.000Z");
    const accounts = new PrismaSharedAccountRepository(() => now);

    const created = await accounts.create(member.id, vault.id, bytes("member-created"), 1);
    expect(created.status).toBe("SUCCESS");
    if (created.status !== "SUCCESS") throw new Error("Expected account creation.");
    const accountId = created.value.id;

    const updated = await accounts.update(member.id, vault.id, accountId, 1, bytes("member-updated"), 1);
    expect(updated.status).toBe("SUCCESS");
    await expect(accounts.delete(member.id, vault.id, accountId, 2)).resolves.toEqual({ status: "PERMISSION_DENIED" });
    await expect(accounts.delete(owner.id, vault.id, accountId, 1)).resolves.toEqual({ status: "STALE_REVISION" });
    await expect(accounts.delete(owner.id, vault.id, accountId, 2)).resolves.toEqual({ status: "SUCCESS", value: undefined });
    await expect(accounts.restore(member.id, vault.id, accountId)).resolves.toEqual({ status: "PERMISSION_DENIED" });
    await expect(accounts.restore(owner.id, vault.id, accountId)).resolves.toEqual({ status: "SUCCESS", value: undefined });

    const audit = await prisma.vaultAuditEvent.findMany({
      where: { vaultId: vault.id },
      orderBy: { createdAt: "asc" },
      select: { eventType: true, ownerId: true, actorUserId: true, targetId: true }
    });
    expect(audit).toEqual([
      { eventType: "ACCOUNT_ADDED", ownerId: owner.id, actorUserId: member.id, targetId: accountId },
      { eventType: "ACCOUNT_UPDATED", ownerId: owner.id, actorUserId: member.id, targetId: accountId },
      { eventType: "ACCOUNT_DELETED", ownerId: owner.id, actorUserId: owner.id, targetId: accountId },
      { eventType: "ACCOUNT_RESTORED", ownerId: owner.id, actorUserId: owner.id, targetId: accountId }
    ]);
    expect(JSON.stringify(audit)).not.toContain("member-updated");
  });
});

function finallyCleanup() {
  afterEach(async () => {
    await prisma.vaultAuditEvent.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.authenticatorAccount.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.vaultInvitation.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.vaultMember.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.vault.deleteMany({ where: { id: { in: vaultIds.splice(0) } } });
    await prisma.applicationUser.deleteMany({ where: { id: { in: userIds.splice(0) } } });
    await prisma.$disconnect();
  });
}

async function createSharedVault(
  overrides: { canAddAccountsOverride: boolean | null; canEditAccountsOverride: boolean | null; canDeleteAccountsOverride: boolean | null } = {
    canAddAccountsOverride: null,
    canEditAccountsOverride: null,
    canDeleteAccountsOverride: null
  },
  defaults: { membersCanAddAccounts: boolean; membersCanEditAccounts: boolean; membersCanDeleteAccounts: boolean } = {
    membersCanAddAccounts: false,
    membersCanEditAccounts: false,
    membersCanDeleteAccounts: false
  }
) {
  const owner = await createUser();
  const member = await createUser();
  const vault = await prisma.vault.create({
    data: {
      ownerId: owner.id,
      type: "SHARED",
      lifecycle: "ACTIVE",
      encryptedName: bytes("encrypted-name"),
      encryptionVersion: 1,
      ...defaults,
      members: {
        create: [
          { userId: owner.id, role: "OWNER", encryptedVaultKey: bytes("owner-key"), keyVersion: 1 },
          { userId: member.id, role: "VIEWER", encryptedVaultKey: bytes("member-key"), keyVersion: 1, ...overrides }
        ]
      }
    }
  });
  vaultIds.push(vault.id);
  return { owner, member, vault };
}

async function createUser() {
  const user = await prisma.applicationUser.create({
    data: { supabaseUserId: randomUUID(), email: `${randomUUID()}@example.test` }
  });
  userIds.push(user.id);
  return user;
}

function bytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(new TextEncoder().encode(value.padEnd(32, "x")));
}
