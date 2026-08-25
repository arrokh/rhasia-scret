import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { SharedVaultDetailWorkspace } from "@/modules/authenticator-account";
import { loadVaultPageContext, VaultPageFrame } from "@/modules/vault-management/page";

export const dynamic = "force-dynamic";

export default async function SharedVaultPage({ params }: { params: Promise<{ vaultId: string }> }) {
  const t = await getTranslations("VaultManagement.pages");
  return <VaultPageFrame backHref="/vaults/manage" backLabel={t("backDirectory")} title={t("sharedTitle")} description={t("sharedDescription")} contentLabel={t("sharedLabel")}><SharedVaultContent params={params} /></VaultPageFrame>;
}

async function SharedVaultContent({ params }: { params: Promise<{ vaultId: string }> }) {
  const [{ user, personalVault }, { vaultId }] = await Promise.all([loadVaultPageContext(), params]);
  if (personalVault.lifecycle === "UNINITIALIZED") redirect("/vaults");
  return <SharedVaultDetailWorkspace personalVaultId={personalVault.id} vaultId={vaultId} ownerEmail={user.email} />;
}
