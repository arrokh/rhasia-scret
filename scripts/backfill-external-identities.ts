import "dotenv/config";
import { prisma } from "../src/shared/infrastructure/prisma-client";

async function main(): Promise<void> {
  const users = await prisma.applicationUser.findMany({
    where: { supabaseUserId: { not: null } },
    select: { id: true, supabaseUserId: true, email: true }
  });
  if (!users.length) {
    console.log("Backfilled 0 Supabase External Identities.");
    return;
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL is required for the Supabase identity backfill.");
  const issuer = `${supabaseUrl.replace(/\/$/, "")}/auth/v1`;
  for (const user of users) {
    if (!user.supabaseUserId) continue;
    const legacy = await prisma.externalIdentity.findUnique({ where: { issuer_subject: { issuer: "supabase", subject: user.supabaseUserId } }, select: { id: true } });
    const canonical = await prisma.externalIdentity.findUnique({ where: { issuer_subject: { issuer, subject: user.supabaseUserId } }, select: { id: true } });
    if (legacy && !canonical) {
      await prisma.externalIdentity.update({ where: { id: legacy.id }, data: { issuer, email: user.email, emailVerifiedAt: new Date() } });
    } else if (legacy && canonical) {
      await prisma.externalIdentity.delete({ where: { id: legacy.id } });
    }
    await prisma.externalIdentity.upsert({
      where: { issuer_subject: { issuer, subject: user.supabaseUserId } },
      create: { applicationUserId: user.id, issuer, subject: user.supabaseUserId, email: user.email, emailVerifiedAt: new Date() },
      update: { applicationUserId: user.id, email: user.email, emailVerifiedAt: new Date() }
    });
  }
  const remaining = await prisma.applicationUser.count({ where: { supabaseUserId: { not: null }, externalIdentities: { none: { issuer } } } });
  if (remaining !== 0) throw new Error(`External identity backfill incomplete: ${remaining} Application Users remain.`);
  console.log(`Backfilled ${users.length} Supabase External Identities.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "External identity backfill failed.");
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
