import "dotenv/config";
import { prisma } from "../src/shared/infrastructure/prisma-client";

async function main(): Promise<void> {
  const users = await prisma.applicationUser.findMany({
    where: { supabaseUserId: { not: null } },
    select: { id: true, supabaseUserId: true, email: true }
  });
  for (const user of users) {
    if (!user.supabaseUserId) continue;
    await prisma.externalIdentity.upsert({
      where: { issuer_subject: { issuer: "supabase", subject: user.supabaseUserId } },
      create: { applicationUserId: user.id, issuer: "supabase", subject: user.supabaseUserId, email: user.email, emailVerifiedAt: new Date() },
      update: { applicationUserId: user.id, email: user.email, emailVerifiedAt: new Date() }
    });
  }
  const remaining = await prisma.applicationUser.count({ where: { supabaseUserId: { not: null }, externalIdentities: { none: { issuer: "supabase" } } } });
  if (remaining !== 0) throw new Error(`External identity backfill incomplete: ${remaining} Application Users remain.`);
  console.log(`Backfilled ${users.length} Supabase External Identities.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "External identity backfill failed.");
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
