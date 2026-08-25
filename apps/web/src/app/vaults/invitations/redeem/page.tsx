import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { InvitationRedemptionWorkspace } from "@/modules/authenticator-account";
import { loadVaultPageContext, VaultPageFrame } from "@/modules/vault-management/page";

export const dynamic = "force-dynamic";

export default async function RedeemInvitationPage() {
  const t = await getTranslations("VaultManagement.pages");
  return <VaultPageFrame backHref="/vaults/manage" backLabel={t("backDirectory")} title={t("invitationTitle")} description={t("invitationDescription")} contentLabel={t("invitationLabel")}><InvitationContent /></VaultPageFrame>;
}

async function InvitationContent() {
  const { personalVault } = await loadVaultPageContext();
  if (personalVault.lifecycle === "UNINITIALIZED") redirect("/vaults");
  return <InvitationRedemptionWorkspace personalVaultId={personalVault.id} />;
}
