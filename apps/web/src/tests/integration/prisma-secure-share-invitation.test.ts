import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaSecureShareLinkRepository } from "@/modules/vault-membership/infrastructure/prisma-secure-share-link-repository";
import { prisma } from "@/shared/infrastructure/prisma-client";

const userIds: string[] = [];
const vaultIds: string[] = [];
afterEach(async () => {
  await prisma.vaultInvitation.deleteMany({ where: { vaultId: { in: vaultIds } } });
  await prisma.vaultMember.deleteMany({ where: { vaultId: { in: vaultIds } } });
  await prisma.vault.deleteMany({ where: { id: { in: vaultIds.splice(0) } } });
  await prisma.applicationUser.deleteMany({ where: { id: { in: userIds.splice(0) } } });
  await prisma.$disconnect();
});

describe("PrismaSecureShareLinkRepository email invitation", () => {
  it.skipIf(!process.env.DATABASE_URL)("creates an email-bound invitation before first sign-in and redeems it once after provisioning", async () => {
    const owner = await user("owner");
    const recipientEmail = `not-yet-provisioned-${randomUUID()}@example.test`;
    const vault = await prisma.vault.create({ data: { ownerId: owner.id, type: "SHARED", lifecycle: "ACTIVE", encryptedName: bytes("name"), encryptionVersion: 1, members: { create: { userId: owner.id, role: "OWNER" } } } });
    vaultIds.push(vault.id);
    const repository = new PrismaSecureShareLinkRepository();
    const verifier = new Uint8Array(32).fill(3);

    const invitation = await repository.createForEmail(owner.id, vault.id, recipientEmail.toUpperCase(), { linkVerifier: verifier, encryptedPackage: bytes("encrypted-package") });
    await expect(prisma.vaultInvitation.findUnique({ where: { id: invitation.id }, select: { recipientEmail: true, recipientUserId: true } })).resolves.toEqual({ recipientEmail, recipientUserId: null });

    const recipient = await user("recipient", recipientEmail);
    await expect(repository.findForRecipient({ userId: recipient.id, email: recipientEmail.toUpperCase() }, verifier)).resolves.toEqual(expect.objectContaining({ id: invitation.id, vaultId: vault.id }));
    await repository.redeem({ userId: recipient.id, email: recipientEmail }, invitation.id, bytes("wrapped-vault-key"), 1);

    await expect(prisma.vaultMember.findUnique({ where: { vaultId_userId: { vaultId: vault.id, userId: recipient.id } }, select: { role: true, status: true } })).resolves.toEqual({ role: "VIEWER", status: "ACTIVE" });
    await expect(prisma.vaultInvitation.findUnique({ where: { id: invitation.id }, select: { recipientUserId: true, status: true, redeemedAt: true } })).resolves.toEqual({ recipientUserId: recipient.id, status: "REDEEMED", redeemedAt: expect.any(Date) });
    await expect(repository.findForRecipient({ userId: recipient.id, email: recipientEmail }, verifier)).resolves.toBeNull();
  });

  it.skipIf(!process.env.DATABASE_URL)("atomically replaces an expired Invitation with fresh link material", async () => {
    const owner = await user("owner");
    const recipient = await user("recipient");
    const vault = await prisma.vault.create({ data: { ownerId: owner.id, type: "SHARED", lifecycle: "ACTIVE", encryptedName: bytes("name"), encryptionVersion: 1, members: { create: { userId: owner.id, role: "OWNER" } } } });
    vaultIds.push(vault.id);
    const now = new Date("2026-07-29T12:00:00.000Z");
    const oldVerifier = new Uint8Array(32).fill(5);
    const replacementVerifier = new Uint8Array(32).fill(6);
    const expired = await prisma.vaultInvitation.create({ data: { vaultId: vault.id, recipientEmail: recipient.email, recipientUserId: recipient.id, linkVerifier: oldVerifier, encryptedPackage: bytes("old-package"), expiresAt: now } });
    const repository = new PrismaSecureShareLinkRepository(() => now);

    await expect(repository.redeem({ userId: recipient.id, email: recipient.email }, expired.id, bytes("wrapped-vault-key"), 1)).rejects.toThrow("unavailable");
    const replacement = await repository.createForEmail(owner.id, vault.id, recipient.email, { linkVerifier: replacementVerifier, encryptedPackage: bytes("replacement-package") });

    expect(replacement.expiresAt).toEqual(new Date("2026-08-05T12:00:00.000Z"));
    await expect(prisma.vaultInvitation.findUnique({ where: { id: expired.id } })).resolves.toBeNull();
    await expect(repository.findForRecipient({ userId: recipient.id, email: recipient.email }, oldVerifier)).resolves.toBeNull();
    await expect(repository.findForRecipient({ userId: recipient.id, email: recipient.email }, replacementVerifier)).resolves.toEqual(expect.objectContaining({ id: replacement.id }));
  });

  it.skipIf(!process.env.DATABASE_URL)("binds one pending invitation to a provisioned application user email", async () => {
    const owner = await user("owner");
    const recipient = await user("recipient");
    const vault = await prisma.vault.create({ data: { ownerId: owner.id, type: "SHARED", lifecycle: "ACTIVE", encryptedName: bytes("name"), encryptionVersion: 1, members: { create: { userId: owner.id, role: "OWNER" } } } });
    vaultIds.push(vault.id);
    const repository = new PrismaSecureShareLinkRepository();
    const verifier = new Uint8Array(32).fill(1);

    const invitation = await repository.createForEmail(owner.id, vault.id, recipient.email.toUpperCase(), { linkVerifier: verifier, encryptedPackage: bytes("encrypted-package") });

    await expect(prisma.vaultInvitation.findUnique({ where: { id: invitation.id }, select: { recipientUserId: true } })).resolves.toEqual({ recipientUserId: recipient.id });
    await expect(repository.createForEmail(owner.id, vault.id, recipient.email, { linkVerifier: new Uint8Array(32).fill(2), encryptedPackage: bytes("another-package") })).rejects.toThrow("pending invitation");

    await prisma.vault.update({ where: { id: vault.id }, data: { lifecycle: "DELETED", deletedAt: new Date(), purgeAfter: new Date(Date.now() + 86_400_000) } });
    await expect(repository.findForRecipient({ userId: recipient.id, email: recipient.email }, verifier)).resolves.toBeNull();
  });

  it.skipIf(!process.env.DATABASE_URL)("reactivates a revoked membership with every personal permission override cleared", async () => {
    const owner = await user("owner");
    const recipient = await user("recipient");
    const vault = await prisma.vault.create({
      data: {
        ownerId: owner.id,
        type: "SHARED",
        lifecycle: "ACTIVE",
        encryptedName: bytes("name"),
        encryptionVersion: 1,
        members: { create: [
          { userId: owner.id, role: "OWNER" },
          { userId: recipient.id, role: "VIEWER", status: "REVOKED", canAddAccountsOverride: true, canEditAccountsOverride: false, canDeleteAccountsOverride: true }
        ] }
      }
    });
    vaultIds.push(vault.id);
    const repository = new PrismaSecureShareLinkRepository();
    const invitation = await repository.createForEmail(owner.id, vault.id, recipient.email, { linkVerifier: new Uint8Array(32).fill(8), encryptedPackage: bytes("encrypted-package") });

    await repository.redeem({ userId: recipient.id, email: recipient.email }, invitation.id, bytes("wrapped-vault-key"), 1);

    await expect(prisma.vaultMember.findUnique({
      where: { vaultId_userId: { vaultId: vault.id, userId: recipient.id } },
      select: { status: true, canAddAccountsOverride: true, canEditAccountsOverride: true, canDeleteAccountsOverride: true, permissionsRevision: true }
    })).resolves.toEqual({ status: "ACTIVE", canAddAccountsOverride: null, canEditAccountsOverride: null, canDeleteAccountsOverride: null, permissionsRevision: 2 });
  });

  it.skipIf(!process.env.DATABASE_URL)("does not let a recycled email override an invitation already bound to another user id", async () => {
    const owner = await user("owner");
    const originalEmail = `recipient-${randomUUID()}@example.test`;
    const intendedRecipient = await user("recipient", originalEmail);
    const vault = await prisma.vault.create({ data: { ownerId: owner.id, type: "SHARED", lifecycle: "ACTIVE", encryptedName: bytes("name"), encryptionVersion: 1, members: { create: { userId: owner.id, role: "OWNER" } } } });
    vaultIds.push(vault.id);
    const repository = new PrismaSecureShareLinkRepository();
    const verifier = new Uint8Array(32).fill(4);
    await repository.createForEmail(owner.id, vault.id, originalEmail, { linkVerifier: verifier, encryptedPackage: bytes("encrypted-package") });

    await prisma.applicationUser.update({ where: { id: intendedRecipient.id }, data: { email: `changed-${randomUUID()}@example.test` } });
    const otherUser = await user("other", originalEmail);

    await expect(repository.findForRecipient({ userId: otherUser.id, email: originalEmail }, verifier)).resolves.toBeNull();
  });
});

async function user(label: string, email = `${label}-${randomUUID()}@example.test`) { const result = await prisma.applicationUser.create({ data: { supabaseUserId: randomUUID(), email } }); userIds.push(result.id); return result; }
function bytes(value: string) { return new TextEncoder().encode(value); }
