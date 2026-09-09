import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaSharedVaultRecoveryRepository } from "@/modules/vault-management/infrastructure/prisma-shared-vault-recovery-repository";
import { PrismaVaultAuditRepository } from "@/modules/audit/infrastructure/prisma-vault-audit-repository";
import { prisma } from "@/shared/infrastructure/prisma-client";

const userIds: string[] = [];
const vaultIds: string[] = [];

afterEach(async () => {
  await prisma.vaultAuditEvent.deleteMany({ where: { vaultId: { in: vaultIds } } });
  await prisma.authenticatorAccount.deleteMany({ where: { vaultId: { in: vaultIds } } });
  await prisma.vaultMember.deleteMany({ where: { vaultId: { in: vaultIds } } });
  await prisma.vault.deleteMany({ where: { id: { in: vaultIds.splice(0) } } });
  await prisma.applicationUser.deleteMany({ where: { id: { in: userIds.splice(0) } } });
  await prisma.$disconnect();
});

describe("PrismaVaultAuditRepository", () => {
  it.skipIf(!process.env.DATABASE_URL)(
    "records account access only for active Shared Vault members and reveals it only to the owner",
    async () => {
      const users = await Promise.all(
        ["owner", "viewer", "outsider"].map(async (name) => {
          const user = await prisma.applicationUser.create({
            data: { supabaseUserId: randomUUID(), email: `${name}-${randomUUID()}@example.test` },
          });
          userIds.push(user.id);
          return user;
        }),
      );
      const [owner, viewer, outsider] = users as [
        (typeof users)[number],
        (typeof users)[number],
        (typeof users)[number],
      ];
      const vault = await prisma.vault.create({
        data: {
          ownerId: owner.id,
          type: "SHARED",
          lifecycle: "ACTIVE",
          encryptedName: bytes("name"),
          encryptionVersion: 1,
          members: {
            create: [
              { userId: owner.id, role: "OWNER" },
              { userId: viewer.id, role: "VIEWER" },
            ],
          },
          accounts: { create: { encryptedPayload: bytes("account"), encryptionVersion: 1 } },
        },
        include: { accounts: true },
      });
      vaultIds.push(vault.id);
      const account = vault.accounts[0]!;
      const repository = new PrismaVaultAuditRepository();

      await expect(repository.recordAccountAccess(viewer.id, vault.id, account.id)).resolves.toBe(true);
      await expect(repository.recordAccountAccess(outsider.id, vault.id, account.id)).resolves.toBe(false);
      await expect(repository.listForOwner(viewer.id, vault.id)).resolves.toBeNull();
      await expect(repository.listForOwner(owner.id, vault.id)).resolves.toEqual({
        items: [
          expect.objectContaining({
            eventType: "ACCOUNT_ACCESSED",
            targetId: account.id,
            actorUserId: viewer.id,
            actorEmail: viewer.email,
          }),
        ],
        nextCursor: null,
      });
      await expect(
        repository.listForOwner(owner.id, vault.id, { accountId: account.id, actorUserId: viewer.id }),
      ).resolves.toEqual(expect.objectContaining({ items: [expect.any(Object)] }));
      await expect(repository.listForOwner(owner.id, vault.id, { accountId: "different-account" })).resolves.toEqual({
        items: [],
        nextCursor: null,
      });
      await expect(repository.listForOwner(owner.id, vault.id, { actorUserId: outsider.id })).resolves.toEqual({
        items: [],
        nextCursor: null,
      });

      const personalVault = await prisma.vault.create({
        data: {
          ownerId: owner.id,
          type: "PERSONAL",
          lifecycle: "ACTIVE",
          encryptedName: bytes("personal-name"),
          encryptionVersion: 1,
        },
      });
      vaultIds.push(personalVault.id);
      const personalAccounts = await Promise.all(
        ["one", "two"].map((value) =>
          prisma.authenticatorAccount.create({
            data: { vaultId: personalVault.id, encryptedPayload: bytes(value), encryptionVersion: 1 },
          }),
        ),
      );
      await expect(
        repository.recordPersonalAccountCopiesToLocal(
          owner.id,
          personalVault.id,
          personalAccounts.map(({ id }) => id),
        ),
      ).resolves.toBe(true);
      await expect(
        repository.recordPersonalAccountCopiesToLocal(viewer.id, personalVault.id, [personalAccounts[0]!.id]),
      ).resolves.toBe(false);
      await expect(
        repository.recordPersonalAccountCopiesToLocal(owner.id, personalVault.id, [account.id]),
      ).resolves.toBe(false);
      await expect(repository.recordArchiveExport(owner.id, personalVault.id)).resolves.toBe(true);
      await expect(repository.recordArchiveExport(viewer.id, personalVault.id)).resolves.toBe(false);
      await expect(repository.listForOwner(owner.id, personalVault.id)).resolves.toEqual({
        items: expect.arrayContaining([
          expect.objectContaining({ eventType: "ARCHIVE_EXPORTED", targetId: null, actorUserId: owner.id }),
          ...personalAccounts.map(({ id }) =>
            expect.objectContaining({ eventType: "ACCOUNT_COPIED_TO_LOCAL", targetId: id, actorUserId: owner.id }),
          ),
        ]),
        nextCursor: null,
      });
      await expect(repository.listForOwner(viewer.id, personalVault.id)).resolves.toBeNull();
      await expect(repository.recordArchiveExport(owner.id, vault.id)).resolves.toBe(true);
      await expect(repository.recordArchiveExport(viewer.id, vault.id)).resolves.toBe(false);
      expect(await prisma.vaultAuditEvent.count({ where: { vaultId: vault.id, eventType: "ARCHIVE_EXPORTED" } })).toBe(
        1,
      );

      const tiedAt = new Date("2026-07-26T11:00:00.000Z");
      await prisma.vaultAuditEvent.createMany({
        data: [
          {
            id: `audit-a-${randomUUID()}`,
            vaultId: vault.id,
            ownerId: owner.id,
            actorUserId: viewer.id,
            eventType: "ACCOUNT_ACCESSED",
            targetId: "tie-target",
            createdAt: tiedAt,
          },
          {
            id: `audit-z-${randomUUID()}`,
            vaultId: vault.id,
            ownerId: owner.id,
            actorUserId: viewer.id,
            eventType: "ACCOUNT_ACCESSED",
            targetId: "tie-target",
            createdAt: tiedAt,
          },
        ],
      });
      const firstPage = await repository.listForOwner(
        owner.id,
        vault.id,
        { accountId: "tie-target" },
        { cursor: null, limit: 1 },
      );
      await prisma.vaultAuditEvent.delete({ where: { id: firstPage!.items[0]!.id } });
      const secondPage = await repository.listForOwner(
        owner.id,
        vault.id,
        { accountId: "tie-target" },
        { cursor: firstPage!.nextCursor, limit: 1 },
      );
      expect(firstPage!.items[0]!.id).toMatch(/^audit-z-/);
      expect(secondPage!.items[0]!.id).toMatch(/^audit-a-/);
      expect(secondPage!.nextCursor).toBeNull();

      const deletedAt = new Date("2026-07-26T12:00:00.000Z");
      await new PrismaSharedVaultRecoveryRepository(() => deletedAt).delete(owner.id, vault.id);
      await expect(
        new PrismaVaultAuditRepository(() => new Date("2026-08-01T00:00:00.000Z")).listForOwner(owner.id, vault.id),
      ).resolves.toEqual(
        expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({ eventType: "ACCOUNT_ACCESSED" }),
            expect.objectContaining({ eventType: "VAULT_DELETED" }),
          ]),
        }),
      );
      await expect(repository.listForOwner(viewer.id, vault.id)).resolves.toBeNull();
      await expect(repository.recordAccountAccess(viewer.id, vault.id, account.id)).resolves.toBe(false);
      await expect(repository.recordArchiveExport(owner.id, vault.id)).resolves.toBe(false);
    },
  );
});

function bytes(value: string) {
  return new TextEncoder().encode(value);
}
