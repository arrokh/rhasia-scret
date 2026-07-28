import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { SharedVaultCreationWorkspace } from "@/modules/authenticator-account";
import { loadVaultPageContext } from "@/app/vaults/load-vault-page-context";
import { VaultPageFrame } from "@/app/vaults/vault-page-frame";

export const dynamic = "force-dynamic";

export default async function NewSharedVaultPage() {
  const t = await getTranslations("VaultManagement.pages");
  return <VaultPageFrame backHref="/vaults/manage" backLabel={t("backDirectory")} title={t("newSharedTitle")} description={t("newSharedDescription")} contentLabel={t("newSharedLabel")}><NewSharedVaultContent /></VaultPageFrame>;
}

async function NewSharedVaultContent() {
  const { personalVault } = await loadVaultPageContext();
  if (personalVault.lifecycle === "UNINITIALIZED") redirect("/vaults");
  return <SharedVaultCreationWorkspace personalVaultId={personalVault.id} />;
}
