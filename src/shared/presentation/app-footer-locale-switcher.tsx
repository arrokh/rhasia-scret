"use client";

import { usePathname } from "next/navigation";
import { LocaleSwitcher } from "@/i18n/locale-switcher";

export function AppFooterLocaleSwitcher() {
  const pathname = usePathname();
  const languageIsInSettings = pathname === "/vaults" || pathname.startsWith("/vaults/") || pathname === "/totp";

  return languageIsInSettings ? null : <LocaleSwitcher />;
}
