import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { loadVaultPageContext } from "@/app/vaults/load-vault-page-context";
import { VaultPageFrame } from "@/app/vaults/vault-page-frame";
import { VaultArchiveImportWorkspace } from "@/modules/vault-archive";

export const dynamic = "force-dynamic";

export default async function VaultArchiveImportPage() {
  const t = await getTranslations("VaultArchive.page");
  return <VaultPageFrame backHref="/vaults/manage" backLabel={t("back")} title={t("title")} description={t("description")} contentLabel={t("label")}><VaultArchiveImportContent /></VaultPageFrame>;
}

async function VaultArchiveImportContent() {
  const { personalVault } = await loadVaultPageContext();
  if (personalVault.lifecycle === "UNINITIALIZED") redirect("/vaults");
  return <VaultArchiveImportWorkspace personalVaultId={personalVault.id} />;
}
