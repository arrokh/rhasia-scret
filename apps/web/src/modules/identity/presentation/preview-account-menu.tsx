"use client";

import { useTranslations } from "next-intl";
import { LogoutForm } from "./logout-form";

export function PreviewAccountMenu() {
  const t = useTranslations("AuthenticatorAccount.accounts");
  return <LogoutForm email="preview@local.invalid" lockLabel={t("lock")} onLock={() => undefined} />;
}
