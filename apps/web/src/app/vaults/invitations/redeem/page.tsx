import { LockKeyhole } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { InvitationRedemptionWorkspace } from "@/modules/authenticator-account";
import { loadVaultPageContext, PersonalVaultSetupFormBoundary, VaultPageFrame } from "@/modules/vault-management/page";
import { SecureShareLinkSecretProvider } from "@/modules/vault-membership";
import { SectionHeading } from "@/shared/presentation/app-ui";
import { ContextualHelpButton } from "@/shared/presentation/contextual-help";

export const dynamic = "force-dynamic";

export default async function RedeemInvitationPage() {
  const t = await getTranslations("VaultManagement.pages");
  return (
    <SecureShareLinkSecretProvider>
      <VaultPageFrame
        backHref="/vaults/manage"
        backLabel={t("backDirectory")}
        title={t("invitationTitle")}
        description={t("invitationDescription")}
        contentLabel={t("invitationLabel")}
      >
        <InvitationContent />
      </VaultPageFrame>
    </SecureShareLinkSecretProvider>
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
        <PersonalVaultSetupFormBoundary />
      </div>
    );
  return <InvitationRedemptionWorkspace personalVaultId={personalVault.id} />;
}
