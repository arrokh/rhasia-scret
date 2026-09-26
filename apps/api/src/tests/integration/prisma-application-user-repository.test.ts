import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaApplicationUserRepository } from "@api/modules/identity/infrastructure/prisma-application-user-repository";
import { prisma } from "@api/tests/integration/prisma";

const subjects: string[] = [];

afterEach(async () => {
  if (subjects.length) {
    const identities = await prisma.externalIdentity.findMany({
      where: { subject: { in: subjects.splice(0) } },
      select: { applicationUserId: true },
    });
    await prisma.applicationUser.deleteMany({
      where: { id: { in: identities.map(({ applicationUserId }) => applicationUserId) } },
    });
  }
});

describe("PrismaApplicationUserRepository", () => {
  it.skipIf(!process.env.DATABASE_URL)("provisions a user idempotently from a verified principal", async () => {
    const subject = randomUUID();
    subjects.push(subject);
    const repository = new PrismaApplicationUserRepository(prisma);
    const principal = {
      issuer: "rhasia:passwordless",
      subject,
      email: "first@example.test",
      emailVerified: true,
      assurance: "fresh-provider-user" as const,
    };
    const first = await repository.provision(principal);
    const second = await repository.provision({ ...principal, email: "second@example.test" });

    expect(second.id).toBe(first.id);
    expect(second.email).toBe("second@example.test");
    await expect(prisma.externalIdentity.count({ where: { issuer: "rhasia:passwordless", subject } })).resolves.toBe(1);
  });

  it.skipIf(!process.env.DATABASE_URL)(
    "returns the identity that authenticated when an Application User has multiple External Identities",
    async () => {
      const localSubject = randomUUID();
      const externalSubject = randomUUID();
      const externalIssuer = "https://identity.example.test";
      subjects.push(localSubject, externalSubject);
      const repository = new PrismaApplicationUserRepository(prisma);
      const user = await repository.provision({
        issuer: "rhasia:passwordless",
        subject: localSubject,
        email: "multi-provider@example.test",
        emailVerified: true,
        assurance: "active-session",
      });
      await prisma.externalIdentity.create({
        data: {
          applicationUserId: user.id,
          issuer: externalIssuer,
          subject: externalSubject,
          email: "multi-provider@example.test",
          emailVerifiedAt: new Date(),
        },
      });

      const resolved = await repository.provision({
        issuer: externalIssuer,
        subject: externalSubject,
        email: "multi-provider@example.test",
        emailVerified: true,
        assurance: "active-session",
      });

      expect(resolved.id).toBe(user.id);
      expect(resolved.issuer).toBe(externalIssuer);
      expect(resolved.subject).toBe(externalSubject);
    },
  );

  it.skipIf(!process.env.DATABASE_URL)(
    "provisions one Application User when concurrent requests race on the same external identity",
    async () => {
      const subject = randomUUID();
      subjects.push(subject);
      const repository = new PrismaApplicationUserRepository(prisma);
      const principal = {
        issuer: "https://identity.example.test",
        subject,
        email: "concurrent@example.test",
        emailVerified: true,
        assurance: "active-session" as const,
      };

      const [first, second] = await Promise.all([repository.provision(principal), repository.provision(principal)]);

      expect(second.id).toBe(first.id);
      await expect(
        prisma.externalIdentity.count({ where: { issuer: "https://identity.example.test", subject } }),
      ).resolves.toBe(1);
    },
  );

  it.skipIf(!process.env.DATABASE_URL)(
    "does not write an unchanged existing user during a normal read path",
    async () => {
      const subject = randomUUID();
      subjects.push(subject);
      const repository = new PrismaApplicationUserRepository(prisma);
      const principal = {
        issuer: "rhasia:passwordless",
        subject,
        email: "stable@example.test",
        emailVerified: true,
        assurance: "fresh-provider-user" as const,
      };
      const user = await repository.provision(principal);
      const before = await prisma.applicationUser.findUniqueOrThrow({
        where: { id: user.id },
        select: { updatedAt: true },
      });

      await repository.provision(principal);

      const after = await prisma.applicationUser.findUniqueOrThrow({
        where: { id: user.id },
        select: { updatedAt: true },
      });
      expect(after.updatedAt).toEqual(before.updatedAt);
    },
  );
});
