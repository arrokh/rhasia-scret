import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaApplicationUserRepository } from "@api/modules/identity/infrastructure/prisma-application-user-repository";
import { PrismaPersonalVaultRepository } from "@api/modules/vault-management/infrastructure/prisma-personal-vault-repository";
import { prisma } from "@api/tests/integration/prisma";

const userIds: string[] = [];

afterEach(async () => {
  if (userIds.length) {
    const ids = userIds.splice(0);
    const vaults = await prisma.vault.findMany({ where: { ownerId: { in: ids } }, select: { id: true } });
    await prisma.vaultMember.deleteMany({ where: { vaultId: { in: vaults.map(({ id }) => id) } } });
    await prisma.vault.deleteMany({ where: { ownerId: { in: ids } } });
    await prisma.applicationUser.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.$disconnect();
});

describe("API SSR bootstrap repositories", () => {
  it.skipIf(!process.env.DATABASE_URL)(
    "provisions a user and ensures its Personal Vault through API-owned repositories",
    async () => {
      const email = `${randomUUID()}@example.test`;
      const applicationUser = await new PrismaApplicationUserRepository(prisma).provision({
        issuer: "rhasia:passwordless",
        subject: randomUUID(),
        email,
        emailVerified: true,
        assurance: "active-session",
      });
      userIds.push(applicationUser.id);
      const vault = await new PrismaPersonalVaultRepository(prisma).ensureForOwner(applicationUser.id);
      expect(vault.ownerId).toBe(applicationUser.id);
      expect(vault.type).toBe("PERSONAL");
    },
  );
});
