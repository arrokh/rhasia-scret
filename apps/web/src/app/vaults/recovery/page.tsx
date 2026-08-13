import { getTranslations } from "next-intl/server";
import { PasskeyRecoveryReset } from "@/modules/crypto";
import { loadVaultPageContext } from "@/app/vaults/load-vault-page-context";
import { VaultPageFrame } from "@/app/vaults/vault-page-frame";
import { DestructivePersonalVaultResetForm, OwnedSharedVaultResetBlocker } from "@/modules/vault-management";
import { PrismaDestructivePersonalVaultResetRepository } from "@/modules/vault-management/infrastructure/prisma-destructive-personal-vault-reset-repository";

export const dynamic = "force-dynamic";

export default async function VaultRecoveryPage() {
  const t = await getTranslations("Crypto.recoveryPage");
  return <VaultPageFrame backHref="/vaults" backLabel={t("back")} title={t("title")} description={t("description")} contentLabel={t("label")}><VaultRecoveryContent /></VaultPageFrame>;
}

async function VaultRecoveryContent() {
  const { user } = await loadVaultPageContext();
  const eligibility = await new PrismaDestructivePersonalVaultResetRepository().getEligibility(user.id);
  return <div className="p-5 sm:p-6">{eligibility.passkeyRecoveryEnrolled ? <PasskeyRecoveryReset /> : eligibility.activeOwnedSharedVaults > 0 ? <OwnedSharedVaultResetBlocker vaultIds={eligibility.activeOwnedSharedVaultIds} /> : <DestructivePersonalVaultResetForm />}</div>;
}
