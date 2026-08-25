import { Suspense } from "react";
import { LockKeyhole } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { loadVaultPageContext, VaultPageLogoutAction } from "@/modules/vault-management/page";
import { PersonalVaultSetupForm } from "@/modules/vault-management/presentation/personal-vault-setup-form";
import { PersonalVaultAccounts } from "@/modules/authenticator-account";
import { AppPage, PageHeader, SectionHeading, SurfaceCard } from "@/shared/presentation/app-ui";
import { ActionLoadingPlaceholder } from "@/shared/presentation/loading-placeholder";

export const dynamic = "force-dynamic";

export default async function VaultsPage() {
  const [t, { personalVault }] = await Promise.all([getTranslations("VaultManagement.vaultsPage"), loadVaultPageContext()]);
  const uninitialized = personalVault.lifecycle === "UNINITIALIZED";
  return (
    <AppPage>
      <PageHeader title={t("title")} description={uninitialized ? t("setupDescription") : t("accountsDescription")} action={<Suspense fallback={<ActionLoadingPlaceholder />}><VaultPageLogoutAction /></Suspense>} />
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
