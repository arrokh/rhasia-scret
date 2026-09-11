"use client";

import { usePathname } from "next/navigation";
import { LocaleSwitcher } from "@/i18n/locale-switcher";

export function footerLanguageIsInSettings(pathname: string | null) {
  return (
    pathname === "/vaults" ||
    pathname?.startsWith("/vaults/") === true ||
    pathname === "/ui-preview" ||
    pathname === "/ui-preview/vaults"
  );
}

export function AppFooterLocaleSwitcher() {
  const pathname = usePathname();

  return footerLanguageIsInSettings(pathname) ? null : (
    <span data-slot="app-footer-locale-switcher" className="contents">
      <LocaleSwitcher />
    </span>
  );
}
