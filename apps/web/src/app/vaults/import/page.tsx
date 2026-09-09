import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { loadVaultPageContext, VaultPageFrame } from "@/modules/vault-management/page";
import { VaultArchiveImportWorkspace } from "@/modules/vault-archive";

export const dynamic = "force-dynamic";

export default async function VaultArchiveImportPage() {
  const t = await getTranslations("VaultArchive.page");
  return (
    <VaultPageFrame
      backHref="/vaults/manage"
      backLabel={t("back")}
      title={t("title")}
      description={t("description")}
      contentLabel={t("label")}
    >
      <VaultArchiveImportContent />
    </VaultPageFrame>
  );
}

async function VaultArchiveImportContent() {
  const { personalVault } = await loadVaultPageContext();
  if (personalVault.lifecycle === "UNINITIALIZED") redirect("/vaults");
  return <VaultArchiveImportWorkspace personalVaultId={personalVault.id} />;
}
