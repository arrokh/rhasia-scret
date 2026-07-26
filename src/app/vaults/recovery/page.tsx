import { redirect } from "next/navigation";
import { PasskeyRecoveryReset } from "@/modules/crypto";
import { LogoutForm } from "@/modules/identity";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";
import { DestructivePersonalVaultResetForm, OwnedSharedVaultResetBlocker } from "@/modules/vault-management";
import { PrismaDestructivePersonalVaultResetRepository } from "@/modules/vault-management/infrastructure/prisma-destructive-personal-vault-reset-repository";

export const dynamic = "force-dynamic";

export default async function VaultRecoveryPage() {
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (!user || !user.canAccessApplication()) redirect("/");
  const eligibility = await new PrismaDestructivePersonalVaultResetRepository().getEligibility(user.id);

  return (
    <main className="vault-page">
      <header className="vault-header">
        <div>
          <p className="eyebrow">rhasia-scret</p>
          <h1>Pemulihan brankas</h1>
        </div>
        <LogoutForm email={user.email} />
      </header>
      <section className="vault-card" aria-label="Atur ulang Passphrase Brankas">
        {eligibility.passkeyRecoveryEnrolled ? <PasskeyRecoveryReset /> : eligibility.activeOwnedSharedVaults > 0 ? (
          <OwnedSharedVaultResetBlocker vaultIds={eligibility.activeOwnedSharedVaultIds} />
        ) : <DestructivePersonalVaultResetForm />}
      </section>
    </main>
  );
}
