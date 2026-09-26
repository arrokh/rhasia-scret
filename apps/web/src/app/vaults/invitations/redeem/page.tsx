import { LockKeyhole } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { InvitationRedemptionWorkspace } from "@/modules/authenticator-account";
import { loadVaultPageContext, VaultPageFrame } from "@/modules/vault-management/page";
import { PersonalVaultSetupForm } from "@/modules/vault-management/presentation/personal-vault-setup-form";
import { SectionHeading } from "@/shared/presentation/app-ui";
import { ContextualHelpButton } from "@/shared/presentation/contextual-help";

export const dynamic = "force-dynamic";

export default async function RedeemInvitationPage() {
  const t = await getTranslations("VaultManagement.pages");
  return (
    <VaultPageFrame
      backHref="/vaults/manage"
      backLabel={t("backDirectory")}
      title={t("invitationTitle")}
      description={t("invitationDescription")}
      contentLabel={t("invitationLabel")}
    >
      <InvitationContent />
    </VaultPageFrame>
  );
}

async function InvitationContent() {
  const [vaultsT, { personalVault }] = await Promise.all([
    getTranslations("VaultManagement.vaultsPage"),
    loadVaultPageContext(),
  ]);
  if (personalVault.lifecycle === "UNINITIALIZED")
    return (
      <div className="grid gap-6 p-5 sm:p-6">
        <SectionHeading
          icon={LockKeyhole}
          eyebrow={vaultsT("personal")}
          title={vaultsT("setupTitle")}
          description={vaultsT("setupIntro")}
          action={<ContextualHelpButton topic="personalVaultSetup" />}
        />
        <PersonalVaultSetupForm afterInitializationPath="/vaults/invitations/redeem" />
      </div>
    );
  return <InvitationRedemptionWorkspace personalVaultId={personalVault.id} />;
}
