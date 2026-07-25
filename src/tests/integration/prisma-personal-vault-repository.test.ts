import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaPersonalVaultRepository } from "@/modules/vault-management/infrastructure/prisma-personal-vault-repository";
import { prisma } from "@/shared/infrastructure/prisma-client";

const userIds: string[] = [];

afterEach(async () => {
  if (userIds.length) {
    const vaults = await prisma.vault.findMany({ where: { ownerId: { in: userIds } }, select: { id: true } });
    await prisma.vaultMember.deleteMany({ where: { vaultId: { in: vaults.map((vault) => vault.id) } } });
    await prisma.vault.deleteMany({ where: { ownerId: { in: userIds } } });
    await prisma.applicationUser.deleteMany({ where: { id: { in: userIds.splice(0) } } });
  }
  await prisma.$disconnect();
});

describe("PrismaPersonalVaultRepository", () => {
  it.skipIf(!process.env.DATABASE_URL)("creates exactly one uninitialized Personal Vault for an owner", async () => {
    const user = await prisma.applicationUser.create({
      data: { supabaseUserId: randomUUID(), email: `${randomUUID()}@example.test` }
    });
    userIds.push(user.id);
    const repository = new PrismaPersonalVaultRepository();
    const first = await repository.ensureForOwner(user.id);
    const second = await repository.ensureForOwner(user.id);

    expect(second.id).toBe(first.id);
    expect(first.lifecycle).toBe("UNINITIALIZED");
    await expect(prisma.vault.count({ where: { ownerId: user.id, type: "PERSONAL" } })).resolves.toBe(1);
  });
});
