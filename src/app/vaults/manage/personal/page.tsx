import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PersonalVaultDetailWorkspace } from "@/modules/authenticator-account";
import { loadVaultPageContext } from "@/app/vaults/load-vault-page-context";
import { VaultPageFrame } from "@/app/vaults/vault-page-frame";

export const dynamic = "force-dynamic";

export default async function PersonalVaultManagementPage() {
  const t = await getTranslations("VaultManagement.pages");
  return <VaultPageFrame backHref="/vaults/manage" backLabel={t("backDirectory")} title={t("personalTitle")} description={t("personalDescription")} contentLabel={t("personalLabel")}><PersonalVaultContent /></VaultPageFrame>;
}

async function PersonalVaultContent() {
  const { user, personalVault } = await loadVaultPageContext();
  if (personalVault.lifecycle === "UNINITIALIZED") redirect("/vaults");
  return <PersonalVaultDetailWorkspace personalVaultId={personalVault.id} ownerEmail={user.email} />;
}
