"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useUnlockedVaultWorkspace } from "@/modules/authenticator-account";
import { LogoutForm } from "@/modules/identity";
import { identifyAnalyticsUser } from "@/shared/infrastructure/browser-analytics";

export function PostHogIdentify({ userId }: { userId: string }) {
  useEffect(() => {
    identifyAnalyticsUser(userId);
  }, [userId]);

  return null;
}

export function VaultPageAccountMenu({ email }: { email: string }) {
  const t = useTranslations("AuthenticatorAccount.accounts");
  const { workspace, lockWorkspace } = useUnlockedVaultWorkspace();
  return <LogoutForm email={email} lockLabel={workspace ? t("lock") : undefined} onLock={workspace ? lockWorkspace : undefined} />;
}
