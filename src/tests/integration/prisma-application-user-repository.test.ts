import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { prisma } from "@/shared/infrastructure/prisma-client";

const subjects: string[] = [];

afterEach(async () => {
  if (subjects.length) {
    await prisma.applicationUser.deleteMany({ where: { supabaseUserId: { in: subjects.splice(0) } } });
  }
  await prisma.$disconnect();
});

describe("PrismaApplicationUserRepository", () => {
  it.skipIf(!process.env.DATABASE_URL)("provisions a user idempotently from a verified session", async () => {
    const subject = randomUUID();
    subjects.push(subject);
    const repository = new PrismaApplicationUserRepository();
    const first = await repository.provision({ subject, email: "first@example.test" });
    const second = await repository.provision({ subject, email: "second@example.test" });

    expect(second.id).toBe(first.id);
    expect(second.email).toBe("second@example.test");
    await expect(prisma.applicationUser.count({ where: { supabaseUserId: subject } })).resolves.toBe(1);
  });

  it.skipIf(!process.env.DATABASE_URL)("does not write an unchanged existing user during a normal read path", async () => {
    const subject = randomUUID();
    subjects.push(subject);
    const repository = new PrismaApplicationUserRepository();
    await repository.provision({ subject, email: "stable@example.test" });
    const before = await prisma.applicationUser.findUniqueOrThrow({ where: { supabaseUserId: subject }, select: { updatedAt: true } });

    await repository.provision({ subject, email: "stable@example.test" });

    const after = await prisma.applicationUser.findUniqueOrThrow({ where: { supabaseUserId: subject }, select: { updatedAt: true } });
    expect(after.updatedAt).toEqual(before.updatedAt);
  });
});
