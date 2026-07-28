import { LockKeyhole } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { LogoutForm } from "@/modules/identity";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";
import { ensurePersonalVault } from "@/modules/vault-management/application/ensure-personal-vault";
import { PrismaPersonalVaultRepository } from "@/modules/vault-management/infrastructure/prisma-personal-vault-repository";
import { PersonalVaultSetupForm } from "@/modules/vault-management/presentation/personal-vault-setup-form";
import { PersonalVaultAccounts } from "@/modules/authenticator-account";
import { AppPage, PageHeader, SectionHeading, SurfaceCard } from "@/shared/presentation/app-ui";

export const dynamic = "force-dynamic";

export default async function VaultsPage() {
  const t = await getTranslations("VaultManagement.vaultsPage");
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (!user || !user.canAccessApplication()) redirect("/sign-in");
  const personalVault = await ensurePersonalVault(user.id, new PrismaPersonalVaultRepository());
  const uninitialized = personalVault.lifecycle === "UNINITIALIZED";

  return (
    <AppPage>
      <PageHeader title={t("title")} description={uninitialized ? t("setupDescription") : t("accountsDescription")} action={<LogoutForm email={user.email} />} />
      <SurfaceCard aria-label={uninitialized ? t("setupLabel") : t("accountsLabel")}>
        {uninitialized ? (
          <div className="grid gap-6 p-5 sm:p-6">
            <SectionHeading icon={LockKeyhole} eyebrow={t("personal")} title={t("setupTitle")} description={t("setupIntro")} />
            <PersonalVaultSetupForm />
          </div>
        ) : <PersonalVaultAccounts vaultId={personalVault.id} />}
      </SurfaceCard>
    </AppPage>
  );
}
