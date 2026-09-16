import { getTranslations } from "next-intl/server";
import { PasskeyRecoveryReset } from "@/modules/crypto";
import { loadVaultPageContext, VaultPageFrame } from "@/modules/vault-management/page";
import { DestructivePersonalVaultResetForm, OwnedSharedVaultResetBlocker } from "@/modules/vault-management";
import { loadServerDestructiveResetEligibility } from "@/shared/infrastructure/server-api-gateway";

export const dynamic = "force-dynamic";

export default async function VaultRecoveryPage() {
  const t = await getTranslations("Crypto.recoveryPage");
  return (
    <VaultPageFrame
      backHref="/vaults"
      backLabel={t("back")}
      title={t("title")}
      description={t("description")}
      contentLabel={t("label")}
    >
      <VaultRecoveryContent />
    </VaultPageFrame>
  );
}

async function VaultRecoveryContent() {
  await loadVaultPageContext();
  const eligibility = await loadServerDestructiveResetEligibility();
  return (
    <div className="p-5 sm:p-6">
      {eligibility.passkeyRecoveryEnrolled ? (
        <PasskeyRecoveryReset />
      ) : eligibility.activeOwnedSharedVaults > 0 ? (
        <OwnedSharedVaultResetBlocker vaultIds={eligibility.activeOwnedSharedVaultIds} />
      ) : (
        <DestructivePersonalVaultResetForm />
      )}
    </div>
  );
}
