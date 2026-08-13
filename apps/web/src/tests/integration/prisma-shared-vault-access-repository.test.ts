import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaSharedVaultAccessRepository } from "@/modules/vault-membership/infrastructure/prisma-shared-vault-access-repository";
import { prisma } from "@/shared/infrastructure/prisma-client";

const userIds: string[] = [];

afterEach(async () => {
  if (userIds.length) {
    const vaults = await prisma.vault.findMany({ where: { ownerId: { in: userIds } }, select: { id: true } });
    const vaultIds = vaults.map((vault) => vault.id);
    await prisma.authenticatorAccount.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.vaultMember.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.vault.deleteMany({ where: { id: { in: vaultIds } } });
    await prisma.applicationUser.deleteMany({ where: { id: { in: userIds.splice(0) } } });
  }
  await prisma.$disconnect();
});

describe("PrismaSharedVaultAccessRepository", () => {
  it.skipIf(!process.env.DATABASE_URL)("lists active encrypted Shared Vault material, accounts, and effective permissions for a member", async () => {
    const user = await prisma.applicationUser.create({
      data: { supabaseUserId: randomUUID(), email: `${randomUUID()}@example.test` }
    });
    userIds.push(user.id);
    const vault = await prisma.vault.create({
      data: {
        ownerId: user.id,
        type: "SHARED",
        lifecycle: "ACTIVE",
        encryptedName: Uint8Array.from([1, 2, 3]),
        encryptionVersion: 1,
        members: { create: { userId: user.id, role: "OWNER", encryptedVaultKey: Uint8Array.from([4, 5, 6]), keyVersion: 1 } },
        accounts: { create: { encryptedPayload: Uint8Array.from([7, 8, 9]), encryptionVersion: 1 } }
      }
    });

    const listed = await new PrismaSharedVaultAccessRepository().listForMember(user.id);

    expect(listed).toEqual([expect.objectContaining({
      vaultId: vault.id,
      role: "OWNER",
      encryptedName: Uint8Array.from([1, 2, 3]),
      encryptedVaultKey: Uint8Array.from([4, 5, 6]),
      effectiveAccountPermissions: {
        permissions: { canAddAccounts: true, canEditAccounts: true, canDeleteAccounts: true },
        sources: { canAddAccounts: "OWNER", canEditAccounts: "OWNER", canDeleteAccounts: "OWNER" }
      },
      accounts: [expect.objectContaining({ encryptedPayload: Uint8Array.from([7, 8, 9]) })]
    })]);
  });
});
