import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { createAdminPrismaClient } from "./admin-prisma-client";
import { loadWorkspaceEnvironment } from "./load-workspace-environment";

const LOCAL_ISSUER = "rhasia:passwordless";

async function main(): Promise<void> {
  loadWorkspaceEnvironment();
  const prisma = createAdminPrismaClient();
  try {
    const users = await prisma.applicationUser.findMany({
      select: {
        id: true,
        email: true,
        externalIdentities: { where: { issuer: LOCAL_ISSUER }, select: { id: true, subject: true } },
      },
      orderBy: { id: "asc" },
    });
    const seen = new Map<string, string>();
    let created = 0;
    for (const user of users) {
      const normalizedEmail = normalizeEmail(user.email);
      if (!isEmail(normalizedEmail))
        throw new Error("Passwordless identity seed stopped: an Application User email is invalid.");
      const previous = seen.get(normalizedEmail);
      if (previous && previous !== user.id)
        throw new Error("Passwordless identity seed stopped: normalized Application User emails are not unique.");
      seen.set(normalizedEmail, user.id);
      if (user.externalIdentities.length > 1)
        throw new Error("Passwordless identity seed stopped: an Application User has multiple local identities.");
      const existing = user.externalIdentities[0];
      if (existing) {
        await prisma.externalIdentity.update({
          where: { id: existing.id },
          data: {
            email: user.email,
            emailVerifiedAt: new Date(),
            passwordlessIdentity: { upsert: { create: { normalizedEmail }, update: { normalizedEmail } } },
          },
        });
        continue;
      }
      await prisma.externalIdentity.create({
        data: {
          applicationUserId: user.id,
          issuer: LOCAL_ISSUER,
          subject: randomUUID(),
          email: user.email,
          emailVerifiedAt: new Date(),
          passwordlessIdentity: { create: { normalizedEmail } },
        },
      });
      created += 1;
    }
    const seeded = await prisma.passwordlessIdentity.count();
    console.log(`Passwordless identity seed passed: ${created} created, ${seeded} total local identities.`);
  } finally {
    await prisma.$disconnect();
  }
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

void main().catch((error: unknown) => {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
    console.error(
      "Passwordless identity seed stopped: a normalized email or identity is already bound to another user.",
    );
  else console.error(error instanceof Error ? error.message : "Passwordless identity seed failed.");
  process.exitCode = 1;
});
