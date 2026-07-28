import { Suspense } from "react";
import { LockKeyhole } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { loadVaultPageContext } from "@/app/vaults/load-vault-page-context";
import { VaultPageLogoutAction } from "@/app/vaults/vault-page-logout-action";
import { PersonalVaultSetupForm } from "@/modules/vault-management/presentation/personal-vault-setup-form";
import { PersonalVaultAccounts } from "@/modules/authenticator-account";
import { AppPage, PageHeader, SectionHeading, SurfaceCard } from "@/shared/presentation/app-ui";
import { ActionLoadingPlaceholder, SectionLoadingPlaceholder } from "@/shared/presentation/loading-placeholder";

export const dynamic = "force-dynamic";

export default async function VaultsPage() {
  const t = await getTranslations("VaultManagement.vaultsPage");
  return (
    <AppPage>
      <PageHeader title={t("title")} description={<Suspense fallback={<span aria-hidden="true" className="block h-4 w-full max-w-md animate-pulse rounded bg-muted motion-reduce:animate-none" />}><VaultPageDescription /></Suspense>} action={<Suspense fallback={<ActionLoadingPlaceholder />}><VaultPageLogoutAction /></Suspense>} />
      <Suspense fallback={<SurfaceCard aria-label={t("accountsLabel")}><div className="p-5 sm:p-6"><SectionLoadingPlaceholder rows={3} /></div></SurfaceCard>}>
        <VaultPageContent />
      </Suspense>
    </AppPage>
  );
}

async function VaultPageDescription() {
  const [t, { personalVault }] = await Promise.all([getTranslations("VaultManagement.vaultsPage"), loadVaultPageContext()]);
  return personalVault.lifecycle === "UNINITIALIZED" ? t("setupDescription") : t("accountsDescription");
}

async function VaultPageContent() {
  const [t, { personalVault }] = await Promise.all([getTranslations("VaultManagement.vaultsPage"), loadVaultPageContext()]);
  const uninitialized = personalVault.lifecycle === "UNINITIALIZED";
  return (
    <SurfaceCard aria-label={uninitialized ? t("setupLabel") : t("accountsLabel")}>
      {uninitialized ? (
        <div className="grid gap-6 p-5 sm:p-6">
          <SectionHeading icon={LockKeyhole} eyebrow={t("personal")} title={t("setupTitle")} description={t("setupIntro")} />
          <PersonalVaultSetupForm />
        </div>
      ) : <PersonalVaultAccounts vaultId={personalVault.id} />}
    </SurfaceCard>
  );
}
