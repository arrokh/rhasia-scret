import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaOfflineSyncBundleReader } from "@/modules/sync/infrastructure/prisma-offline-sync-bundle-reader";
import { prisma } from "@/shared/infrastructure/prisma-client";

const userIds: string[] = [];
const opaque = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

afterEach(async () => {
  if (userIds.length) {
    const vaults = await prisma.vault.findMany({ where: { ownerId: { in: userIds } }, select: { id: true } });
    const vaultIds = vaults.map((vault) => vault.id);
    await prisma.authenticatorAccount.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.vaultMember.deleteMany({ where: { OR: [{ vaultId: { in: vaultIds } }, { userId: { in: userIds } }] } });
    await prisma.vault.deleteMany({ where: { id: { in: vaultIds } } });
    await prisma.applicationUser.deleteMany({ where: { id: { in: userIds.splice(0) } } });
  }
  await prisma.$disconnect();
});

describe("PrismaOfflineSyncBundleReader", () => {
  it.skipIf(!process.env.DATABASE_URL)("reads one consistent complete authorized bundle and omits revoked or deleted Vaults", async () => {
    const user = await createUser();
    const otherOwner = await createUser();
    await prisma.userCryptoProfile.create({
      data: {
        userId: user.id,
        vaultUnlockSalt: opaque.slice(0, 16),
        wrappedUserRootKey: opaque,
        rootKeyWrappingVersion: 1,
        encryptedPersonalVaultKey: opaque,
        personalVaultKeyEncryptionVersion: 1,
        userEncryptionPublicKey: { kty: "EC", crv: "P-256", x: "opaque", y: "opaque" },
        encryptedUserPrivateKey: opaque,
        userEncryptionKeyVersion: 1
      }
    });
    const personal = await createVault(user.id, "PERSONAL", "ACTIVE", user.id, "OWNER");
    await prisma.authenticatorAccount.create({ data: { vaultId: personal.id, encryptedPayload: opaque, encryptionVersion: 1 } });
    const owned = await createVault(user.id, "SHARED", "ACTIVE", user.id, "OWNER");
    const viewed = await createVault(otherOwner.id, "SHARED", "ACTIVE", user.id, "VIEWER");
    await prisma.vault.update({ where: { id: viewed.id }, data: { membersCanAddAccounts: true } });
    await prisma.vaultMember.update({ where: { vaultId_userId: { vaultId: viewed.id, userId: user.id } }, data: { canEditAccountsOverride: true, canDeleteAccountsOverride: false } });
    await createVault(otherOwner.id, "SHARED", "ACTIVE", user.id, "VIEWER", "REVOKED");
    await createVault(otherOwner.id, "SHARED", "DELETED", user.id, "VIEWER");

    const bundle = await new PrismaOfflineSyncBundleReader().readAuthorizedBundle(user.id);

    expect(bundle).not.toBeNull();
    expect(bundle?.profileId).toBe(user.id);
    expect(bundle?.personalVault).toEqual(expect.objectContaining({ vaultId: personal.id, accounts: [expect.objectContaining({ revision: 1 })] }));
    expect(bundle?.sharedVaults).toHaveLength(2);
    expect(bundle?.sharedVaults.map(({ vaultId, role }) => ({ vaultId, role }))).toEqual(expect.arrayContaining([
      { vaultId: owned.id, role: "OWNER" },
      { vaultId: viewed.id, role: "VIEWER" }
    ]));
    expect(bundle?.sharedVaults.find(({ vaultId }) => vaultId === viewed.id)?.effectiveAccountPermissions).toEqual({
      permissions: { canAddAccounts: true, canEditAccounts: true, canDeleteAccounts: false },
      sources: { canAddAccounts: "VAULT", canEditAccounts: "MEMBER", canDeleteAccounts: "MEMBER" }
    });
    expect(JSON.stringify(bundle)).not.toContain("encryptedUserPrivateKey");
    expect(JSON.stringify(bundle)).not.toContain(user.email);

    const unchanged = await new PrismaOfflineSyncBundleReader().readAuthorizedBundle(user.id);
    expect(unchanged?.synchronizationToken).toBe(bundle?.synchronizationToken);

    const changedPayload = opaque.slice();
    changedPayload[1] = 9;
    await prisma.authenticatorAccount.create({ data: { vaultId: personal.id, encryptedPayload: changedPayload, encryptionVersion: 1 } });
    const changed = await new PrismaOfflineSyncBundleReader().readAuthorizedBundle(user.id);
    expect(changed?.synchronizationToken).not.toBe(bundle?.synchronizationToken);
  });
});

async function createUser() {
  const user = await prisma.applicationUser.create({ data: { supabaseUserId: randomUUID(), email: `${randomUUID()}@example.test` } });
  userIds.push(user.id);
  return user;
}

async function createVault(ownerId: string, type: "PERSONAL" | "SHARED", lifecycle: "ACTIVE" | "DELETED", memberId: string, role: "OWNER" | "VIEWER", memberStatus = "ACTIVE") {
  return prisma.vault.create({
    data: {
      ownerId,
      type,
      lifecycle,
      encryptedName: opaque,
      encryptionVersion: 1,
      deletedAt: lifecycle === "DELETED" ? new Date() : null,
      members: { create: { userId: memberId, role, status: memberStatus, encryptedVaultKey: type === "SHARED" ? opaque : null, keyVersion: type === "SHARED" ? 1 : null } }
    }
  });
}
