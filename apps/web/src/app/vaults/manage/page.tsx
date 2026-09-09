import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { VaultDirectoryWorkspace } from "@/modules/authenticator-account";
import { loadVaultPageContext, VaultPageFrame } from "@/modules/vault-management/page";

export const dynamic = "force-dynamic";

export default async function VaultDirectoryPage() {
  const t = await getTranslations("VaultManagement.pages");
  return (
    <VaultPageFrame
      backHref="/vaults"
      backLabel={t("backAccounts")}
      backPrefetch
      title={t("directoryTitle")}
      description={t("directoryDescription")}
      contentLabel={t("directoryLabel")}
    >
      <VaultDirectoryContent />
    </VaultPageFrame>
  );
}

async function VaultDirectoryContent() {
  const { personalVault } = await loadVaultPageContext();
  if (personalVault.lifecycle === "UNINITIALIZED") redirect("/vaults");
  return <VaultDirectoryWorkspace personalVaultId={personalVault.id} />;
}
