import { Prisma } from "@prisma/client";
import { createAdminPrismaClient } from "./admin-prisma-client";
import { loadWorkspaceEnvironment } from "./load-workspace-environment";

const LOCAL_ISSUER = "rhasia:passwordless";
// This immutable column name is inspected only to verify the legacy migration;
// Supabase is not an authentication runtime dependency.
const LEGACY_IDENTITY_COLUMN = "supabase_user_id";

async function main(): Promise<void> {
  loadWorkspaceEnvironment();
  const staged = process.argv.includes("--staged");
  const prisma = createAdminPrismaClient();
  try {
    const [
      users,
      localIdentities,
      localUsers,
      localBindings,
      mismatches,
      legacyColumn,
      pwaHandoffTable,
      pwaHandoffEmailColumn,
    ] = await Promise.all([
      prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT COUNT(*)::bigint AS count FROM application_users`),
      prisma.$queryRaw<Array<{ count: bigint }>>(
        Prisma.sql`SELECT COUNT(*)::bigint AS count FROM external_identities WHERE issuer = ${LOCAL_ISSUER}`,
      ),
      prisma.$queryRaw<Array<{ count: bigint }>>(
        Prisma.sql`SELECT COUNT(DISTINCT e.application_user_id)::bigint AS count FROM external_identities e WHERE e.issuer = ${LOCAL_ISSUER}`,
      ),
      prisma.$queryRaw<Array<{ count: bigint }>>(
        Prisma.sql`SELECT COUNT(*)::bigint AS count FROM passwordless_identities p JOIN external_identities e ON e.id = p.external_identity_id WHERE e.issuer = ${LOCAL_ISSUER}`,
      ),
      prisma.$queryRaw<Array<{ count: bigint }>>(
        Prisma.sql`SELECT COUNT(*)::bigint AS count FROM application_users u WHERE NOT EXISTS (SELECT 1 FROM passwordless_identities p JOIN external_identities e ON e.id = p.external_identity_id WHERE e.application_user_id = u.id AND e.issuer = ${LOCAL_ISSUER} AND p.normalized_email = LOWER(BTRIM(u.email)) AND e.email = u.email AND e.email_verified_at IS NOT NULL)`,
      ),
      prisma.$queryRaw<Array<{ count: bigint }>>(
        Prisma.sql`SELECT COUNT(*)::bigint AS count FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'application_users' AND column_name = ${LEGACY_IDENTITY_COLUMN}`,
      ),
      prisma.$queryRaw<Array<{ count: bigint }>>(
        Prisma.sql`SELECT COUNT(*)::bigint AS count FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'pwa_authentication_handoffs'`,
      ),
      prisma.$queryRaw<Array<{ count: bigint }>>(
        Prisma.sql`SELECT COUNT(*)::bigint AS count FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'pwa_authentication_handoffs' AND column_name = 'normalized_email'`,
      ),
    ]);
    const userCount = Number(users[0]?.count ?? 0);
    const identityCount = Number(localIdentities[0]?.count ?? 0);
    const localUserCount = Number(localUsers[0]?.count ?? 0);
    const bindingCount = Number(localBindings[0]?.count ?? 0);
    const mismatchCount = Number(mismatches[0]?.count ?? 0);
    const legacyColumnCount = Number(legacyColumn[0]?.count ?? 0);
    const pwaHandoffTableCount = Number(pwaHandoffTable[0]?.count ?? 0);
    const pwaHandoffEmailColumnCount = Number(pwaHandoffEmailColumn[0]?.count ?? 0);
    if (
      identityCount !== userCount ||
      localUserCount !== userCount ||
      bindingCount !== userCount ||
      mismatchCount !== 0 ||
      (staged ? legacyColumnCount !== 1 : legacyColumnCount !== 0) ||
      (staged ? pwaHandoffTableCount !== 0 : pwaHandoffTableCount !== 1) ||
      (staged ? pwaHandoffEmailColumnCount !== 0 : pwaHandoffEmailColumnCount !== 1)
    )
      throw new Error(
        `Passwordless migration ${staged ? "staged verification" : "verification"} failed: user, identity, distinct-user, binding, email mapping, legacy-column, or PWA handoff schema checks do not match.`,
      );
    console.log(
      staged
        ? `Passwordless migration staged verification passed: ${userCount} Application Users, ${identityCount} local identities, ${bindingCount} bindings, legacy column retained for guarded cleanup.`
        : `Passwordless migration verified: ${userCount} Application Users, ${identityCount} local identities, ${bindingCount} bindings, legacy column absent.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Passwordless migration verification failed.");
  process.exitCode = 1;
});
