import { Suspense } from "react";
import { LockKeyhole } from "lucide-react";
import { getTranslations } from "next-intl/server";
import {
  loadVaultPageContext,
  PersonalVaultSetupFormBoundary,
  VaultPageLogoutAction,
} from "@/modules/vault-management/page";
import { PersonalVaultAccounts } from "@/modules/authenticator-account";
import { AppPage, PageHeader, SectionHeading, StatusBanner, SurfaceCard } from "@/shared/presentation/app-ui";
import { ContextualHelpButton } from "@/shared/presentation/contextual-help";
import { ActionLoadingPlaceholder } from "@/shared/presentation/loading-placeholder";

export const dynamic = "force-dynamic";

export default async function VaultsPage({
  searchParams,
}: {
  searchParams: Promise<{ logout?: string | string[]; reset?: string | string[] }>;
}) {
  const [params, t, resetT, logoutT, { personalVault }] = await Promise.all([
    searchParams,
    getTranslations("VaultManagement.vaultsPage"),
    getTranslations("VaultManagement.destructiveReset"),
    getTranslations("Identity.logout"),
    loadVaultPageContext(),
  ]);
  const uninitialized = personalVault.lifecycle === "UNINITIALIZED";
  return (
    <AppPage>
      <PageHeader
        title={t("title")}
        description={uninitialized ? t("setupDescription") : t("accountsDescription")}
        action={
          <Suspense fallback={<ActionLoadingPlaceholder />}>
            <VaultPageLogoutAction />
          </Suspense>
        }
      />
      {includesQueryValue(params.logout, "failed") && (
        <StatusBanner tone="danger" role="alert">
          {logoutT("cleanupError")}
        </StatusBanner>
      )}
      {includesQueryValue(params.reset, "cleanup-warning") && (
        <StatusBanner tone="warning" role="alert">
          {resetT("cleanupError")}
        </StatusBanner>
      )}
      <SurfaceCard aria-label={uninitialized ? t("setupLabel") : t("accountsLabel")}>
        {uninitialized ? (
          <div className="grid gap-6 p-5 sm:p-6">
            <SectionHeading
              icon={LockKeyhole}
              eyebrow={t("personal")}
              title={t("setupTitle")}
              description={t("setupIntro")}
              action={<ContextualHelpButton topic="personalVaultSetup" />}
            />
            <PersonalVaultSetupFormBoundary />
          </div>
        ) : (
          <PersonalVaultAccounts vaultId={personalVault.id} />
        )}
      </SurfaceCard>
    </AppPage>
  );
}

function includesQueryValue(value: string | string[] | undefined, expected: string): boolean {
  return value === expected || (Array.isArray(value) && value.includes(expected));
}
