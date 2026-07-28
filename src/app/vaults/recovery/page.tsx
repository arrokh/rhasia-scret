import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
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
  const t = await getTranslations("Crypto.recoveryPage");
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (!user || !user.canAccessApplication()) redirect("/sign-in");
  const eligibility = await new PrismaDestructivePersonalVaultResetRepository().getEligibility(user.id);

  return (
    <AppPage>
      <PageHeader backHref="/vaults" backLabel={t("back")} title={t("title")} description={t("description")} action={<LogoutForm email={user.email} />} />
      <SurfaceCard className="p-5 sm:p-6" aria-label={t("label")}>
        {eligibility.passkeyRecoveryEnrolled ? <PasskeyRecoveryReset /> : eligibility.activeOwnedSharedVaults > 0 ? <OwnedSharedVaultResetBlocker vaultIds={eligibility.activeOwnedSharedVaultIds} /> : <DestructivePersonalVaultResetForm />}
      </SurfaceCard>
    </AppPage>
  );
}
