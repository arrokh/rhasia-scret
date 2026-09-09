"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useUnlockedVaultWorkspace } from "@/modules/authenticator-account";
import { LogoutForm } from "@/modules/identity";
import { captureAnalyticsEvent, identifyAnalyticsUser } from "@/shared/infrastructure/browser-analytics";
import { ANALYTICS_EVENTS } from "@/shared/infrastructure/browser-analytics-config";

export function PostHogIdentify({ userId }: { userId: string }) {
  useEffect(() => {
    let active = true;
    void identifyAnalyticsUser(userId).then((identified) => {
      if (active && identified) captureAnalyticsEvent(ANALYTICS_EVENTS.authenticationSessionEstablished);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  return null;
}

export function VaultPageAccountMenu({ email }: { email: string }) {
  const t = useTranslations("AuthenticatorAccount.accounts");
  const { workspace, lockWorkspace } = useUnlockedVaultWorkspace();
  return (
    <LogoutForm
      email={email}
      lockLabel={workspace ? t("lock") : undefined}
      onLock={workspace ? lockWorkspace : undefined}
    />
  );
}
