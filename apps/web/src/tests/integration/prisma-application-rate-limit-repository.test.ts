import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaApplicationRateLimitRepository } from "@/modules/rate-limiting/infrastructure/prisma-application-rate-limit-repository";
import { prisma } from "@/shared/infrastructure/prisma-client";

const userIds: string[] = [];

afterEach(async () => {
  await prisma.applicationRateLimitWindow.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.applicationUser.deleteMany({ where: { id: { in: userIds.splice(0) } } });
  await prisma.$disconnect();
});

describe("Prisma application rate-limit repository", () => {
  it.skipIf(!process.env.DATABASE_URL)(
    "atomically enforces a shared limit across concurrent repository instances",
    async () => {
      const user = await createUser("concurrent");
      const repositories = [new PrismaApplicationRateLimitRepository(), new PrismaApplicationRateLimitRepository()];
      // Keep the concurrency assertion away from a fixed-window boundary on shared CI databases.
      const policy = { limit: 5, windowSeconds: 3_600 };
      const decisions = await Promise.all(
        Array.from({ length: 20 }, (_, index) => {
          const repository = repositories[index % repositories.length];
          if (!repository) throw new Error("Expected a repository instance.");
          return repository.consume(user.id, "destructive_mutation", policy);
        }),
      );

      expect(decisions.filter((decision) => decision.allowed)).toHaveLength(5);
      expect(decisions.filter((decision) => !decision.allowed)).toHaveLength(15);
      expect(
        decisions.every(
          (decision) => decision.retryAfterSeconds >= 1 && decision.retryAfterSeconds <= policy.windowSeconds,
        ),
      ).toBe(true);
      await expect(prisma.applicationRateLimitWindow.findMany({ where: { userId: user.id } })).resolves.toEqual([
        expect.objectContaining({ userId: user.id, operation: "destructive_mutation", requestCount: 6 }),
      ]);
    },
    15_000,
  );

  it.skipIf(!process.env.DATABASE_URL)("retains only a bounded period of expired aggregate windows", async () => {
    const user = await createUser("retention");
    const now = Date.now();
    await prisma.applicationRateLimitWindow.createMany({
      data: [
        {
          userId: user.id,
          operation: "old_metric",
          windowStartedAt: new Date(now - 49 * 60 * 60 * 1_000),
          expiresAt: new Date(now - 48 * 60 * 60 * 1_000),
          requestCount: 1,
        },
        {
          userId: user.id,
          operation: "recent_metric",
          windowStartedAt: new Date(now - 2 * 60 * 60 * 1_000),
          expiresAt: new Date(now - 60 * 60 * 1_000),
          requestCount: 1,
        },
      ],
    });

    await new PrismaApplicationRateLimitRepository().consume(user.id, "audit_event", { limit: 1, windowSeconds: 60 });

    await expect(
      prisma.applicationRateLimitWindow.findMany({ where: { userId: user.id }, select: { operation: true } }),
    ).resolves.toEqual(expect.arrayContaining([{ operation: "recent_metric" }, { operation: "audit_event" }]));
    expect(
      await prisma.applicationRateLimitWindow.findFirst({ where: { userId: user.id, operation: "old_metric" } }),
    ).toBeNull();
  });

  it.skipIf(!process.env.DATABASE_URL)(
    "isolates users and operation classes while sharing alternate-route budgets",
    async () => {
      const first = await createUser("first");
      const second = await createUser("second");
      const repository = new PrismaApplicationRateLimitRepository();
      const policy = { limit: 1, windowSeconds: 60 };

      await expect(repository.consume(first.id, "account_mutation", policy)).resolves.toMatchObject({ allowed: true });
      await expect(repository.consume(first.id, "account_mutation", policy)).resolves.toMatchObject({ allowed: false });
      await expect(repository.consume(first.id, "vault_mutation", policy)).resolves.toMatchObject({ allowed: true });
      await expect(repository.consume(second.id, "account_mutation", policy)).resolves.toMatchObject({ allowed: true });
    },
  );
});

async function createUser(label: string) {
  const suffix = randomUUID();
  const user = await prisma.applicationUser.create({
    data: { supabaseUserId: `${label}-${suffix}`, email: `${label}-${suffix}@example.test` },
  });
  userIds.push(user.id);
  return user;
}
