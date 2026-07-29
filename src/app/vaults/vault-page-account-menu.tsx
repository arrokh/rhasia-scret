"use client";

import { useTranslations } from "next-intl";
import { useUnlockedVaultWorkspace } from "@/modules/authenticator-account";
import { LogoutForm } from "@/modules/identity";

export function VaultPageAccountMenu({ email }: { email: string }) {
  const t = useTranslations("AuthenticatorAccount.accounts");
  const { workspace, lockWorkspace } = useUnlockedVaultWorkspace();
  return <LogoutForm email={email} lockLabel={workspace ? t("lock") : undefined} onLock={workspace ? lockWorkspace : undefined} />;
}
