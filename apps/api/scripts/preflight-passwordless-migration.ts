import { Prisma } from "@prisma/client";
import { createAdminPrismaClient } from "./admin-prisma-client";
import { loadWorkspaceEnvironment } from "./load-workspace-environment";

const LOCAL_ISSUER = "rhasia:passwordless";
// This immutable column name is inspected only to gate the legacy migration;
// Supabase is not an authentication runtime dependency.
const LEGACY_IDENTITY_COLUMN = "supabase_user_id";

async function main(): Promise<void> {
  loadWorkspaceEnvironment();
  const prisma = createAdminPrismaClient();
  try {
    const users = await prisma.$queryRaw<Array<{ id: string; email: string }>>(
      Prisma.sql`SELECT id, email FROM application_users ORDER BY id`,
    );
    const seen = new Map<string, string>();
    for (const user of users) {
      const normalizedEmail = normalizeEmail(user.email);
      if (!isEmail(normalizedEmail))
        throw new Error(`Passwordless migration requires valid email metadata for one Application User.`);
      const previous = seen.get(normalizedEmail);
      if (previous && previous !== user.id)
        throw new Error("Passwordless migration stopped: normalized Application User emails are not unique.");
      seen.set(normalizedEmail, user.id);
    }

    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>(
      Prisma.sql`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'application_users' AND column_name = ${LEGACY_IDENTITY_COLUMN}`,
    );
    if (columns.length > 0) {
      const legacySubjects = await prisma.$queryRaw<Array<{ count: bigint }>>(
        Prisma.sql`SELECT COUNT(*)::bigint AS count FROM application_users WHERE ${Prisma.raw(LEGACY_IDENTITY_COLUMN)} IS NOT NULL`,
      );
      console.log(
        `Passwordless migration preflight passed for ${users.length} Application Users (${String(legacySubjects[0]?.count ?? 0)} legacy identity subjects retained for audit migration).`,
      );
    } else {
      const localIdentityTables = await prisma.$queryRaw<Array<{ table_name: string }>>(
        Prisma.sql`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('passwordless_identities', 'magic_link_challenges', 'auth_sessions', 'anonymous_auth_rate_limit_windows')`,
      );
      if (localIdentityTables.some(({ table_name }) => table_name === "passwordless_identities")) {
        const localIdentities = await prisma.$queryRaw<Array<{ count: bigint }>>(
          Prisma.sql`SELECT COUNT(*)::bigint AS count FROM passwordless_identities p JOIN external_identities e ON e.id = p.external_identity_id WHERE e.issuer = ${LOCAL_ISSUER}`,
        );
        if (Number(localIdentities[0]?.count ?? 0) !== users.length)
          throw new Error(
            "Passwordless migration preflight stopped: the legacy column is absent but local identities are incomplete.",
          );
      } else if (users.length > 0) {
        throw new Error(
          "Passwordless migration preflight stopped: authentication tables are absent for existing Application Users.",
        );
      }
      console.log(
        `Passwordless migration preflight passed for ${users.length} Application Users; legacy identity column is already absent.`,
      );
    }
    console.log(`Local identity issuer: ${LOCAL_ISSUER}. No identities are linked by email during migration.`);
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
  console.error(error instanceof Error ? error.message : "Passwordless migration preflight failed.");
  process.exitCode = 1;
});
