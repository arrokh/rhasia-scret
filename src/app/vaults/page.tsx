import { redirect } from "next/navigation";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";
import { ensurePersonalVault } from "@/modules/vault-management/application/ensure-personal-vault";
import { PrismaPersonalVaultRepository } from "@/modules/vault-management/infrastructure/prisma-personal-vault-repository";
import { PersonalVaultSetupForm } from "@/modules/vault-management/presentation/personal-vault-setup-form";
import { PersonalVaultAccounts } from "@/modules/authenticator-account";

export const dynamic = "force-dynamic";

export default async function VaultsPage() {
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (!user || !user.canAccessApplication()) redirect("/");
  const personalVault = await ensurePersonalVault(user.id, new PrismaPersonalVaultRepository());

  return (
    <main>
      <h1>Your Vaults</h1>
      <p>Signed in as {user.email}</p>
      <section aria-labelledby="personal-vault-heading">
        <h2 id="personal-vault-heading">Personal Vault</h2>
        {personalVault.lifecycle === "UNINITIALIZED" ? <PersonalVaultSetupForm /> : <PersonalVaultAccounts vaultId={personalVault.id} />}
      </section>
    </main>
  );
}
