"use client";

import { useState, useTransition } from "react";
import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { ConfirmationDialog } from "@/shared/presentation/confirmation-dialog";
import { useOnlineStatus } from "@/shared/presentation/use-online-status";
import { localeCookieMaxAge, localeCookieName, locales, type AppLocale } from "./config";

export const refreshOfflineShellMessage = "RHSIA_REFRESH_OFFLINE_SHELL";

function persistLocale(nextLocale: AppLocale) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${localeCookieName}=${nextLocale}; Path=/; Max-Age=${localeCookieMaxAge}; SameSite=Lax${secure}`;
  document.documentElement.lang = nextLocale;
}

export function LocaleSwitcher({ embedded = false, onLocaleRequested }: { embedded?: boolean; onLocaleRequested?: (locale: AppLocale) => void }) {
  const locale = useLocale();
  const t = useTranslations("Locale");
  const online = useOnlineStatus();
  const [nextLocale, setNextLocale] = useState<AppLocale | null>(null);
  const activeLanguage = languageName(locale, t);

  function requestLocaleChange(value: string) {
    if ((value !== "id" && value !== "en") || value === locale) return;
    if (onLocaleRequested) onLocaleRequested(value);
    else setNextLocale(value);
  }

  const options = (
    <DropdownMenuRadioGroup value={locale} onValueChange={requestLocaleChange}>
      {locales.map((candidate) => {
        const language = languageName(candidate, t);
        const disabled = !online && candidate !== locale;
        return <DropdownMenuRadioItem key={candidate} value={candidate} disabled={disabled} title={disabled ? t("offlineUnavailable") : language} className="min-h-11" style={{ paddingInlineStart: "0.75rem", paddingInlineEnd: "2.5rem", whiteSpace: "nowrap" }}>{language}</DropdownMenuRadioItem>;
      })}
    </DropdownMenuRadioGroup>
  );

  return <>
    {embedded ? (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger aria-label={t("switcher")} className="min-h-11 px-2"><Languages aria-hidden="true" /><span>{activeLanguage}</span></DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-56 rounded-md border-border bg-popover p-2 shadow-card" aria-label={t("options")}>{options}</DropdownMenuSubContent>
      </DropdownMenuSub>
    ) : (
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="min-h-11 px-2 text-xs" aria-label={t("switcher")} title={t("selected", { language: activeLanguage })}>
            <Languages aria-hidden="true" />
            <span>{activeLanguage}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="rounded-md border-border bg-popover p-2 shadow-card" style={{ width: "min(14rem, calc(100vw - 2rem))" }} aria-label={t("options")}>
          {options}
        </DropdownMenuContent>
      </DropdownMenu>
    )}
    {!onLocaleRequested && nextLocale && nextLocale !== locale && <LocaleChangeConfirmation nextLocale={nextLocale} onCancel={() => setNextLocale(null)} />}
  </>;
}

export function LocaleChangeConfirmation({ nextLocale, onCancel }: { nextLocale: AppLocale; onCancel: () => void }) {
  const locale = useLocale();
  const t = useTranslations("Locale");
  const router = useRouter();
  const online = useOnlineStatus();
  const [pending, startTransition] = useTransition();

  function confirmLocaleChange() {
    if (!nextLocale || nextLocale === locale || pending || !online) return;
    persistLocale(nextLocale);
    navigator.serviceWorker?.controller?.postMessage({ type: refreshOfflineShellMessage });
    startTransition(() => router.refresh());
  }

  return <ConfirmationDialog
    title={t("confirmTitle")}
    description={t("confirmDescription", { language: languageName(nextLocale, t) })}
    confirmLabel={t("confirm")}
    pending={pending}
    onCancel={onCancel}
    onConfirm={confirmLocaleChange}
  />;
}

function languageName(locale: AppLocale, t: ReturnType<typeof useTranslations<"Locale">>): string {
  return locale === "id" ? t("indonesian") : t("english");
}
