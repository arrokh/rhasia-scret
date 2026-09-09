import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaMembershipLifecycleRepository } from "@/modules/vault-membership/infrastructure/prisma-membership-lifecycle-repository";
import { PrismaVaultParticipantRepository } from "@/modules/vault-membership/infrastructure/prisma-vault-participant-repository";
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

describe("PrismaVaultParticipantRepository", () => {
  it.skipIf(!process.env.DATABASE_URL)(
    "lists owner-visible participants and restricts pending Invitation deletion to that owner",
    async () => {
      const owner = await user("owner");
      const viewer = await user("viewer");
      const secondViewer = await user("second-viewer");
      const outsider = await user("outsider");
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
        },
      });
      vaultIds.push(vault.id);
      const tiedAt = new Date("2026-07-26T12:00:00.000Z");
      await prisma.vaultMember.update({
        where: { vaultId_userId: { vaultId: vault.id, userId: viewer.id } },
        data: { createdAt: tiedAt },
      });
      await prisma.vaultMember.create({
        data: { vaultId: vault.id, userId: secondViewer.id, role: "VIEWER", createdAt: tiedAt },
      });
      const invitation = await prisma.vaultInvitation.create({
        data: {
          vaultId: vault.id,
          recipientEmail: "pending@example.test",
          linkVerifier: bytes(randomUUID()),
          encryptedPackage: bytes("package"),
          expiresAt: new Date("2026-07-27T12:00:00.000Z"),
        },
      });
      const repository = new PrismaVaultParticipantRepository(() => new Date("2026-07-29T12:00:00.000Z"));

      await expect(repository.listForOwner(outsider.id, vault.id, { cursor: null, limit: 1 })).resolves.toBeNull();
      const orderedViewerIds = [viewer.id, secondViewer.id].sort();
      const firstPage = await repository.listForOwner(owner.id, vault.id, { cursor: null, limit: 1 });
      expect(firstPage).toEqual(
        expect.objectContaining({
          owner: { id: owner.id, email: owner.email },
          items: [expect.objectContaining({ kind: "MEMBER", userId: orderedViewerIds[0] })],
          nextCursor: expect.objectContaining({ key: `member:${orderedViewerIds[0]}` }),
        }),
      );
      const secondPage = await repository.listForOwner(owner.id, vault.id, { cursor: firstPage!.nextCursor, limit: 1 });
      expect(secondPage).toEqual(
        expect.objectContaining({
          items: [expect.objectContaining({ kind: "MEMBER", userId: orderedViewerIds[1] })],
          nextCursor: expect.objectContaining({ key: `member:${orderedViewerIds[1]}` }),
        }),
      );
      const thirdPage = await repository.listForOwner(owner.id, vault.id, { cursor: secondPage!.nextCursor, limit: 1 });
      expect(thirdPage).toEqual(
        expect.objectContaining({
          items: [
            expect.objectContaining({
              kind: "INVITATION",
              invitationId: invitation.id,
              invitationState: "EXPIRED",
              expiresAt: new Date("2026-07-27T12:00:00.000Z"),
              userId: null,
              email: "pending@example.test",
            }),
          ],
          nextCursor: null,
        }),
      );

      await expect(repository.cancelInvitation(outsider.id, vault.id, invitation.id)).resolves.toBe(false);
      await expect(repository.cancelInvitation(owner.id, vault.id, invitation.id)).resolves.toBe(true);
      await expect(prisma.vaultInvitation.findUnique({ where: { id: invitation.id } })).resolves.toBeNull();

      const memberships = new PrismaMembershipLifecycleRepository();
      await expect(memberships.revoke(outsider.id, vault.id, viewer.id)).rejects.toThrow("owner access");
      await expect(memberships.revoke(owner.id, vault.id, viewer.id)).resolves.toBeUndefined();
      await expect(
        prisma.vaultMember.findUnique({
          where: { vaultId_userId: { vaultId: vault.id, userId: viewer.id } },
          select: { status: true },
        }),
      ).resolves.toEqual({ status: "REVOKED" });
    },
  );
});

async function user(label: string) {
  const result = await prisma.applicationUser.create({
    data: { supabaseUserId: randomUUID(), email: `${label}-${randomUUID()}@example.test` },
  });
  userIds.push(result.id);
  return result;
}
function bytes(value: string) {
  return new TextEncoder().encode(value.padEnd(16, "x"));
}
