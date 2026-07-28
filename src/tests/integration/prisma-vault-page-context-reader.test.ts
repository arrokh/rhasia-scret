import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaVaultPageContextReader } from "@/modules/vault-management/infrastructure/prisma-vault-page-context-reader";
import { prisma } from "@/shared/infrastructure/prisma-client";

const subjects: string[] = [];

afterEach(async () => {
  if (subjects.length) {
    const users = await prisma.applicationUser.findMany({ where: { supabaseUserId: { in: subjects.splice(0) } }, select: { id: true } });
    const userIds = users.map(({ id }) => id);
    const vaults = await prisma.vault.findMany({ where: { ownerId: { in: userIds } }, select: { id: true } });
    const vaultIds = vaults.map(({ id }) => id);
    await prisma.vaultMember.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.vault.deleteMany({ where: { id: { in: vaultIds } } });
    await prisma.applicationUser.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.$disconnect();
});

describe("PrismaVaultPageContextReader", () => {
  it.skipIf(!process.env.DATABASE_URL)("loads user access and Personal Vault metadata in one read projection", async () => {
    const subject = randomUUID();
    subjects.push(subject);
    const user = await prisma.applicationUser.create({ data: { supabaseUserId: subject, email: `${subject}@example.test` } });
    const vault = await prisma.vault.create({
      data: {
        ownerId: user.id,
        type: "PERSONAL",
        lifecycle: "ACTIVE",
        encryptionVersion: 1,
        members: { create: { userId: user.id, role: "OWNER" } }
      }
    });

    await expect(new PrismaVaultPageContextReader().findBySessionSubject(subject)).resolves.toEqual({
      user: { id: user.id, email: user.email, status: "ACTIVE" },
      personalVault: { id: vault.id, lifecycle: "ACTIVE" }
    });
  });
});
