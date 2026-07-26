import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  ActiveOwnedSharedVaultsPreventResetError,
  PasskeyRecoveryAlreadyEnrolledError
} from "@/modules/vault-management/application/destructive-personal-vault-reset";
import { PrismaDestructivePersonalVaultResetRepository } from "@/modules/vault-management/infrastructure/prisma-destructive-personal-vault-reset-repository";
import { PrismaSecureShareLinkRepository } from "@/modules/vault-membership/infrastructure/prisma-secure-share-link-repository";
import { prisma } from "@/shared/infrastructure/prisma-client";

const userIds: string[] = [];

async function createUser() {
  const user = await prisma.applicationUser.create({
    data: { supabaseUserId: randomUUID(), email: `${randomUUID()}@example.test` }
  });
  userIds.push(user.id);
  return user;
}

async function createInitializedPersonalVault(userId: string) {
  const vault = await prisma.vault.create({
    data: {
      ownerId: userId,
      type: "PERSONAL",
      lifecycle: "ACTIVE",
      encryptedName: bytes("personal-name"),
      encryptionVersion: 1,
      members: { create: { userId, role: "OWNER" } },
      accounts: { create: { encryptedPayload: bytes("personal-account"), encryptionVersion: 1 } }
    }
  });
  await prisma.userCryptoProfile.create({
    data: {
      userId,
      vaultUnlockSalt: new Uint8Array(16).fill(1),
      wrappedUserRootKey: bytes("wrapped-root-key"),
      rootKeyWrappingVersion: 1,
      encryptedPersonalVaultKey: bytes("personal-vault-key"),
      personalVaultKeyEncryptionVersion: 1,
      userEncryptionPublicKey: { kty: "EC" },
      encryptedUserPrivateKey: bytes("private-key"),
      userEncryptionKeyVersion: 1
    }
  });
  return vault;
}

async function cleanup() {
  if (!userIds.length) return;
  const ids = userIds.splice(0);
  const vaults = await prisma.vault.findMany({
    where: { OR: [{ ownerId: { in: ids } }, { members: { some: { userId: { in: ids } } } }] },
    select: { id: true }
  });
  const vaultIds = vaults.map(({ id }) => id);
  await prisma.vaultAuditEvent.deleteMany({ where: { vaultId: { in: vaultIds } } });
  await prisma.authenticatorAccount.deleteMany({ where: { vaultId: { in: vaultIds } } });
  await prisma.vaultInvitation.deleteMany({ where: { OR: [{ vaultId: { in: vaultIds } }, { recipientUserId: { in: ids } }] } });
  await prisma.vaultMember.deleteMany({ where: { OR: [{ vaultId: { in: vaultIds } }, { userId: { in: ids } }] } });
  await prisma.passkeyRecoveryChallenge.deleteMany({ where: { userId: { in: ids } } });
  await prisma.passkeyRecoveryCredential.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userCryptoProfile.deleteMany({ where: { userId: { in: ids } } });
  await prisma.vault.deleteMany({ where: { id: { in: vaultIds } } });
  await prisma.applicationUser.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
}

afterEach(cleanup);

describe("PrismaDestructivePersonalVaultResetRepository", () => {
  it.skipIf(!process.env.DATABASE_URL)("destroys only the user's unusable material and leaves invited Shared Vault data intact", async () => {
    const [resettingUser, sharedOwner] = await Promise.all([createUser(), createUser()]);
    const personalVault = await createInitializedPersonalVault(resettingUser.id);
    const sharedVault = await prisma.vault.create({
      data: {
        ownerId: sharedOwner.id,
        type: "SHARED",
        lifecycle: "ACTIVE",
        encryptedName: bytes("shared-name"),
        encryptionVersion: 1,
        members: {
          create: [
            { userId: sharedOwner.id, role: "OWNER", encryptedVaultKey: bytes("owner-key"), keyVersion: 1 },
            { userId: resettingUser.id, role: "VIEWER", encryptedVaultKey: bytes("viewer-key"), keyVersion: 1 }
          ]
        },
        accounts: { create: { encryptedPayload: bytes("shared-account"), encryptionVersion: 1 } }
      }
    });
    await prisma.vaultInvitation.create({
      data: {
        vaultId: sharedVault.id,
        recipientUserId: resettingUser.id,
        linkVerifier: bytes(randomUUID()),
        encryptedPackage: bytes("pending-package"),
        status: "PENDING"
      }
    });
    await prisma.passkeyRecoveryChallenge.create({
      data: { userId: resettingUser.id, purpose: "REGISTRATION", challenge: randomUUID(), expiresAt: new Date(Date.now() + 60_000) }
    });

    await new PrismaDestructivePersonalVaultResetRepository().reset(resettingUser.id);

    await expect(prisma.userCryptoProfile.findUnique({ where: { userId: resettingUser.id } })).resolves.toBeNull();
    await expect(prisma.authenticatorAccount.count({ where: { vaultId: personalVault.id } })).resolves.toBe(0);
    await expect(prisma.passkeyRecoveryChallenge.count({ where: { userId: resettingUser.id } })).resolves.toBe(0);
    await expect(prisma.vaultInvitation.count({ where: { recipientUserId: resettingUser.id, status: "PENDING" } })).resolves.toBe(0);
    await expect(prisma.vault.findUnique({ where: { id: personalVault.id }, select: { lifecycle: true, encryptedName: true } })).resolves.toEqual({ lifecycle: "UNINITIALIZED", encryptedName: null });
    await expect(prisma.vaultMember.findUnique({ where: { vaultId_userId: { vaultId: sharedVault.id, userId: resettingUser.id } }, select: { status: true, encryptedVaultKey: true, keyVersion: true } })).resolves.toEqual({ status: "LEFT", encryptedVaultKey: null, keyVersion: null });
    await expect(prisma.vault.findUnique({ where: { id: sharedVault.id }, select: { lifecycle: true } })).resolves.toEqual({ lifecycle: "ACTIVE" });
    await expect(prisma.authenticatorAccount.count({ where: { vaultId: sharedVault.id } })).resolves.toBe(1);
    await expect(prisma.vaultMember.findUnique({ where: { vaultId_userId: { vaultId: sharedVault.id, userId: sharedOwner.id } }, select: { status: true } })).resolves.toEqual({ status: "ACTIVE" });

    const shareLinks = new PrismaSecureShareLinkRepository();
    const replacementInvitation = await shareLinks.create(sharedOwner.id, sharedVault.id, {
      recipientUserId: resettingUser.id,
      linkVerifier: bytes(randomUUID()),
      encryptedPackage: bytes("replacement-package")
    });
    await shareLinks.redeem(resettingUser.id, replacementInvitation.id, bytes("replacement-viewer-key"), 2);
    await expect(prisma.vaultMember.findUnique({
      where: { vaultId_userId: { vaultId: sharedVault.id, userId: resettingUser.id } },
      select: { status: true, encryptedVaultKey: true, keyVersion: true, revokedAt: true }
    })).resolves.toEqual({ status: "ACTIVE", encryptedVaultKey: bytes("replacement-viewer-key"), keyVersion: 2, revokedAt: null });
  });

  it.skipIf(!process.env.DATABASE_URL)("rejects reset while the user owns an active Shared Vault", async () => {
    const user = await createUser();
    await createInitializedPersonalVault(user.id);
    await prisma.vault.create({
      data: { ownerId: user.id, type: "SHARED", lifecycle: "ACTIVE", encryptedName: bytes("owned-shared"), encryptionVersion: 1, members: { create: { userId: user.id, role: "OWNER" } } }
    });

    await expect(new PrismaDestructivePersonalVaultResetRepository().reset(user.id)).rejects.toBeInstanceOf(ActiveOwnedSharedVaultsPreventResetError);
    await expect(prisma.userCryptoProfile.findUnique({ where: { userId: user.id } })).resolves.not.toBeNull();
  });

  it.skipIf(!process.env.DATABASE_URL)("rejects destructive reset when passkey recovery exists", async () => {
    const user = await createUser();
    await createInitializedPersonalVault(user.id);
    await prisma.passkeyRecoveryCredential.create({
      data: {
        userId: user.id,
        credentialId: bytes(randomUUID()),
        publicKey: bytes("public-key"),
        encryptedRecoveryPackage: bytes("recovery-package")
      }
    });

    await expect(new PrismaDestructivePersonalVaultResetRepository().reset(user.id)).rejects.toBeInstanceOf(PasskeyRecoveryAlreadyEnrolledError);
    await expect(prisma.userCryptoProfile.findUnique({ where: { userId: user.id } })).resolves.not.toBeNull();
  });
});

function bytes(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value.padEnd(16, "x"));
}
