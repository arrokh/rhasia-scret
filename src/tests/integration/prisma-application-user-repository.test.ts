import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { prisma } from "@/shared/infrastructure/prisma-client";

const subjects: string[] = [];

afterEach(async () => {
  if (subjects.length) {
    const identities = await prisma.externalIdentity.findMany({ where: { subject: { in: subjects.splice(0) } }, select: { applicationUserId: true } });
    await prisma.applicationUser.deleteMany({ where: { id: { in: identities.map(({ applicationUserId }) => applicationUserId) } } });
  }
});

describe("PrismaApplicationUserRepository", () => {
  it.skipIf(!process.env.DATABASE_URL)("provisions a user idempotently from a verified principal", async () => {
    const subject = randomUUID();
    subjects.push(subject);
    const repository = new PrismaApplicationUserRepository();
    const principal = { issuer: "supabase", subject, email: "first@example.test", emailVerified: true, assurance: "fresh-provider-user" as const };
    const first = await repository.provision(principal);
    const second = await repository.provision({ ...principal, email: "second@example.test" });

    expect(second.id).toBe(first.id);
    expect(second.email).toBe("second@example.test");
    await expect(prisma.externalIdentity.count({ where: { issuer: "supabase", subject } })).resolves.toBe(1);
  });

  it.skipIf(!process.env.DATABASE_URL)("does not write an unchanged existing user during a normal read path", async () => {
    const subject = randomUUID();
    subjects.push(subject);
    const repository = new PrismaApplicationUserRepository();
    const principal = { issuer: "supabase", subject, email: "stable@example.test", emailVerified: true, assurance: "fresh-provider-user" as const };
    const user = await repository.provision(principal);
    const before = await prisma.applicationUser.findUniqueOrThrow({ where: { id: user.id }, select: { updatedAt: true } });

    await repository.provision(principal);

    const after = await prisma.applicationUser.findUniqueOrThrow({ where: { id: user.id }, select: { updatedAt: true } });
    expect(after.updatedAt).toEqual(before.updatedAt);
  });
});
