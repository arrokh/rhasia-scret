"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { LocaleSwitcher } from "@/i18n/locale-switcher";

export function footerLanguageIsHidden(pathname: string | null) {
  return (
    pathname === "/vaults" ||
    pathname?.startsWith("/vaults/") === true ||
    pathname === "/ui-preview" ||
    pathname === "/ui-preview/vaults"
  );
}

export function footerLanguageIsMobileOnly(pathname: string | null) {
  return pathname === "/";
}

export function AppFooterLocaleSwitcher() {
  const pathname = usePathname();
  const t = useTranslations("Locale");

  return footerLanguageIsHidden(pathname) ? null : (
    <span
      data-slot="app-footer-locale-switcher"
      className={footerLanguageIsMobileOnly(pathname) ? "contents sm:hidden" : "contents"}
    >
      <span aria-hidden="true" className="select-none text-muted-foreground">
        |
      </span>
      <LocaleSwitcher triggerLabel={t("footerLabel")} />
    </span>
  );
}
