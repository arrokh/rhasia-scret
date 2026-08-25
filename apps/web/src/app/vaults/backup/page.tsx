import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { loadVaultPageContext, VaultPageFrame } from "@/modules/vault-management/page";
import { VaultArchiveExportWorkspace } from "@/modules/vault-archive";

export const dynamic = "force-dynamic";

export default async function VaultArchiveBackupPage() {
  const t = await getTranslations("VaultArchive.backupPage");
  return <VaultPageFrame backHref="/vaults/manage" backLabel={t("back")} title={t("title")} description={t("description")} contentLabel={t("label")}><VaultArchiveBackupContent /></VaultPageFrame>;
}

async function VaultArchiveBackupContent() {
  const { personalVault } = await loadVaultPageContext();
  if (personalVault.lifecycle === "UNINITIALIZED") redirect("/vaults");
  return <VaultArchiveExportWorkspace personalVaultId={personalVault.id} />;
}
