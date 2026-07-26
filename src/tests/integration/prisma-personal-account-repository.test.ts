import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaPersonalAccountRepository } from "@/modules/authenticator-account/infrastructure/prisma-personal-account-repository";
import { prisma } from "@/shared/infrastructure/prisma-client";

const userIds: string[] = [];
const vaultIds: string[] = [];

afterEach(async () => {
  await prisma.authenticatorAccount.deleteMany({ where: { vaultId: { in: vaultIds } } });
  await prisma.vault.deleteMany({ where: { id: { in: vaultIds.splice(0) } } });
  await prisma.applicationUser.deleteMany({ where: { id: { in: userIds.splice(0) } } });
  await prisma.$disconnect();
});

describe("PrismaPersonalAccountRepository recovery", () => {
  it.skipIf(!process.env.DATABASE_URL)("restores before the 30-day deadline, advances revision, and rejects expiry", async () => {
    const user = await prisma.applicationUser.create({ data: { supabaseUserId: randomUUID(), email: `${randomUUID()}@example.test` } });
    userIds.push(user.id);
    const vault = await prisma.vault.create({ data: { ownerId: user.id, type: "PERSONAL", lifecycle: "ACTIVE", encryptedName: Uint8Array.of(1), encryptionVersion: 1 } });
    vaultIds.push(vault.id);
    const account = await prisma.authenticatorAccount.create({ data: { vaultId: vault.id, encryptedPayload: Uint8Array.of(1, 2, 3), encryptionVersion: 1 } });
    const deletedAt = new Date("2026-07-27T00:00:00.000Z");

    await expect(new PrismaPersonalAccountRepository(() => deletedAt).delete(user.id, vault.id, account.id, 1)).resolves.toBe(true);
    await expect(new PrismaPersonalAccountRepository(() => new Date("2026-08-25T23:59:59.999Z")).restore(user.id, vault.id, account.id)).resolves.toBe(true);
    await expect(prisma.authenticatorAccount.findUnique({ where: { id: account.id }, select: { revision: true, deletedAt: true, purgeAfter: true } })).resolves.toEqual({ revision: 3, deletedAt: null, purgeAfter: null });

    await expect(new PrismaPersonalAccountRepository(() => deletedAt).delete(user.id, vault.id, account.id, 3)).resolves.toBe(true);
    await expect(new PrismaPersonalAccountRepository(() => new Date("2026-08-26T00:00:00.000Z")).restore(user.id, vault.id, account.id)).resolves.toBe(false);
  });
});
