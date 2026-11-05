import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaPasskeyRecoveryRepository } from "@api/modules/identity/infrastructure/prisma-passkey-recovery-repository";
import { prisma } from "@api/tests/integration/prisma";

const userIds: string[] = [];

afterEach(async () => {
  const ids = userIds.splice(0);
  if (ids.length) {
    await prisma.passkeyRecoveryChallenge.deleteMany({ where: { userId: { in: ids } } });
    await prisma.passkeyRecoveryCredential.deleteMany({ where: { userId: { in: ids } } });
    await prisma.applicationUser.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.$disconnect();
});

describe("PrismaPasskeyRecoveryRepository concurrency", () => {
  it.skipIf(!process.env.DATABASE_URL)(
    "serializes challenge issuance and allows only one concurrent consume",
    async () => {
      const user = await createUser();
      const repository = new PrismaPasskeyRecoveryRepository(prisma);
      await Promise.all([
        repository.issueChallenge(user.id, "AUTHENTICATION", "synthetic-challenge-one"),
        repository.issueChallenge(user.id, "AUTHENTICATION", "synthetic-challenge-two"),
      ]);
      await expect(prisma.passkeyRecoveryChallenge.count({ where: { userId: user.id } })).resolves.toBe(1);
      await prisma.passkeyRecoveryChallenge.deleteMany({ where: { userId: user.id } });

      await prisma.passkeyRecoveryChallenge.createMany({
        data: [
          {
            userId: user.id,
            purpose: "AUTHENTICATION",
            challenge: "synthetic-older-challenge",
            createdAt: new Date(Date.now() - 1_000),
            expiresAt: new Date(Date.now() + 60_000),
          },
          {
            userId: user.id,
            purpose: "AUTHENTICATION",
            challenge: "synthetic-newer-challenge",
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
          },
        ],
      });

      const consumed = await Promise.all([
        repository.consumeChallenge(user.id, "AUTHENTICATION"),
        repository.consumeChallenge(user.id, "AUTHENTICATION"),
      ]);

      expect(consumed.filter(Boolean)).toHaveLength(1);
      expect(consumed.filter(Boolean)).toContain("synthetic-newer-challenge");
      await expect(prisma.passkeyRecoveryChallenge.count({ where: { userId: user.id } })).resolves.toBe(0);
    },
    15_000,
  );

  it.skipIf(!process.env.DATABASE_URL)(
    "updates only the passkey counter value that was verified",
    async () => {
      const user = await createUser();
      const credentialId = Uint8Array.of(1, 2, 3, 4);
      await prisma.passkeyRecoveryCredential.create({
        data: {
          userId: user.id,
          credentialId,
          publicKey: Uint8Array.of(5, 6, 7, 8),
          counter: 3n,
          encryptedRecoveryPackage: Uint8Array.of(9, 10, 11, 12),
        },
      });
      const repository = new PrismaPasskeyRecoveryRepository(prisma);

      const results = await Promise.all([
        repository.updateCounter(user.id, credentialId, 3n, 4n),
        repository.updateCounter(user.id, credentialId, 3n, 5n),
      ]);

      expect(results.filter(Boolean)).toHaveLength(1);
      const credential = await prisma.passkeyRecoveryCredential.findUniqueOrThrow({ where: { userId: user.id } });
      expect([4n, 5n]).toContain(credential.counter);
    },
    15_000,
  );
});

async function createUser() {
  const user = await prisma.applicationUser.create({ data: { email: `${randomUUID()}@example.test` } });
  userIds.push(user.id);
  return user;
}
