import { redirect } from "next/navigation";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";

export const dynamic = "force-dynamic";

export default async function VaultsPage() {
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (!user || !user.canAccessApplication()) redirect("/");

  return (
    <main>
      <h1>Your Vaults</h1>
      <p>Signed in as {user.email}</p>
      <p>Your Personal Vault will be initialized in the next setup step.</p>
    </main>
  );
}
