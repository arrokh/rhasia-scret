"use client";

import { useTranslations } from "next-intl";
import { LogoutForm } from "@/modules/identity";

export function PreviewAccountMenu() {
  const t = useTranslations("AuthenticatorAccount.accounts");
  return <LogoutForm email="preview@local.invalid" lockLabel={t("lock")} onLock={() => undefined} />;
}
