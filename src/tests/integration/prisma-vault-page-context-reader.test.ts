import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaVaultPageContextReader } from "@/modules/vault-management/infrastructure/prisma-vault-page-context-reader";
import { prisma } from "@/shared/infrastructure/prisma-client";

const subjects: string[] = [];

afterEach(async () => {
  if (subjects.length) {
    const identities = await prisma.externalIdentity.findMany({ where: { subject: { in: subjects.splice(0) } }, select: { applicationUserId: true } });
    const userIds = identities.map(({ applicationUserId }) => applicationUserId);
    const vaults = await prisma.vault.findMany({ where: { ownerId: { in: userIds } }, select: { id: true } });
    const vaultIds = vaults.map(({ id }) => id);
    await prisma.vaultMember.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.vault.deleteMany({ where: { id: { in: vaultIds } } });
    await prisma.applicationUser.deleteMany({ where: { id: { in: userIds } } });
  }
});

describe("PrismaVaultPageContextReader", () => {
  it.skipIf(!process.env.DATABASE_URL)("loads user access and Personal Vault metadata in one read projection", async () => {
    const subject = randomUUID();
    subjects.push(subject);
    const user = await prisma.applicationUser.create({
      data: {
        email: `${subject}@example.test`,
        externalIdentities: { create: { issuer: "supabase", subject, email: `${subject}@example.test`, emailVerifiedAt: new Date() } }
      }
    });
    const vault = await prisma.vault.create({
      data: {
        ownerId: user.id,
        type: "PERSONAL",
        lifecycle: "ACTIVE",
        encryptionVersion: 1,
        members: { create: { userId: user.id, role: "OWNER" } }
      }
    });

    await expect(new PrismaVaultPageContextReader().findByExternalIdentity("supabase", subject)).resolves.toEqual({
      user: { id: user.id, email: user.email, status: "ACTIVE" },
      personalVault: { id: vault.id, lifecycle: "ACTIVE" }
    });
  });
});
