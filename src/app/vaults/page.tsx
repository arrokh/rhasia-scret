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
    <main className="vault-page">
      <header className="vault-header">
        <p className="eyebrow">BRANKAS ANDA</p>
        <h1>Akun autentikator</h1>
        <p className="vault-subtitle">Masuk sebagai {user.email}</p>
      </header>
      <section className="vault-card" aria-labelledby="personal-vault-heading">
        <div className="vault-card-heading"><div><p className="eyebrow">PRIBADI</p><h2 id="personal-vault-heading">Brankas Pribadi</h2></div><span className="vault-lock" aria-label="Brankas terenkripsi">🔒</span></div>
        {personalVault.lifecycle === "UNINITIALIZED" ? <PersonalVaultSetupForm /> : <PersonalVaultAccounts vaultId={personalVault.id} />}
      </section>
    </main>
  );
}
