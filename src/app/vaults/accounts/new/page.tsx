import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthenticatorAccountCreator } from "@/modules/authenticator-account";
import { loadVaultPageContext } from "@/app/vaults/load-vault-page-context";
import { VaultPageFrame } from "@/app/vaults/vault-page-frame";

export const dynamic = "force-dynamic";

export default async function NewAuthenticatorAccountPage({ searchParams }: { searchParams: Promise<{ vaultId?: string }> }) {
  const t = await getTranslations("VaultManagement.pages");
  return <VaultPageFrame backHref="/vaults" backLabel={t("backVaults")} title={t("newAccountTitle")} description={t("newAccountDescription")} contentLabel={t("newAccountLabel")}><NewAccountContent searchParams={searchParams} /></VaultPageFrame>;
}

async function NewAccountContent({ searchParams }: { searchParams: Promise<{ vaultId?: string }> }) {
  const [{ personalVault }, { vaultId: preferredVaultId }] = await Promise.all([loadVaultPageContext(), searchParams]);
  if (personalVault.lifecycle === "UNINITIALIZED") redirect("/vaults");
  return <AuthenticatorAccountCreator personalVaultId={personalVault.id} preferredVaultId={preferredVaultId} />;
}
