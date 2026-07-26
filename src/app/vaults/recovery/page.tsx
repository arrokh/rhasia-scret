import { redirect } from "next/navigation";
import { PasskeyRecoveryReset } from "@/modules/crypto";
import { LogoutForm } from "@/modules/identity";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";
import { DestructivePersonalVaultResetForm, OwnedSharedVaultResetBlocker } from "@/modules/vault-management";
import { PrismaDestructivePersonalVaultResetRepository } from "@/modules/vault-management/infrastructure/prisma-destructive-personal-vault-reset-repository";
import { AppPage, PageHeader, SurfaceCard } from "@/shared/presentation/app-ui";

export const dynamic = "force-dynamic";

export default async function VaultRecoveryPage() {
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (!user || !user.canAccessApplication()) redirect("/");
  const eligibility = await new PrismaDestructivePersonalVaultResetRepository().getEligibility(user.id);

  return (
    <AppPage>
      <PageHeader backHref="/vaults" backLabel="Kembali ke brankas" title="Pemulihan brankas" description="Pilih jalur yang tersedia untuk mendapatkan kembali akses ke brankas Anda." action={<LogoutForm email={user.email} />} />
      <SurfaceCard className="p-5 sm:p-6" aria-label="Atur ulang Passphrase Brankas">
        {eligibility.passkeyRecoveryEnrolled ? <PasskeyRecoveryReset /> : eligibility.activeOwnedSharedVaults > 0 ? <OwnedSharedVaultResetBlocker vaultIds={eligibility.activeOwnedSharedVaultIds} /> : <DestructivePersonalVaultResetForm />}
      </SurfaceCard>
    </AppPage>
  );
}
