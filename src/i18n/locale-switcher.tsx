"use client";

import { useTransition } from "react";
import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useOnlineStatus } from "@/shared/presentation/use-online-status";
import { localeCookieMaxAge, localeCookieName, locales, type AppLocale } from "./config";

export const refreshOfflineShellMessage = "RHSIA_REFRESH_OFFLINE_SHELL";

function persistLocale(nextLocale: AppLocale) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${localeCookieName}=${nextLocale}; Path=/; Max-Age=${localeCookieMaxAge}; SameSite=Lax${secure}`;
  document.documentElement.lang = nextLocale;
}

export function LocaleSwitcher() {
  const locale = useLocale();
  const t = useTranslations("Locale");
  const router = useRouter();
  const online = useOnlineStatus();
  const [pending, startTransition] = useTransition();

  function selectLocale(nextLocale: AppLocale) {
    if (nextLocale === locale || pending) return;
    persistLocale(nextLocale);
    navigator.serviceWorker?.controller?.postMessage({ type: refreshOfflineShellMessage });
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex items-center gap-1" role="group" aria-label={t("switcher")} aria-busy={pending}>
      <Languages className="mr-1 size-4 text-muted-foreground" aria-hidden="true" />
      {locales.map((candidate) => {
        const language = candidate === "id" ? t("indonesian") : t("english");
        const selected = candidate === locale;
        return (
          <Button
            key={candidate}
            type="button"
            variant="ghost"
            size="sm"
            className={cn("min-h-11 min-w-11 px-2 text-xs", selected && "bg-muted text-foreground")}
            aria-label={language}
            aria-pressed={selected}
            title={!online && !selected ? t("offlineUnavailable") : selected ? t("selected", { language }) : language}
            disabled={pending || (!online && !selected)}
            onClick={() => selectLocale(candidate)}
          >
            {candidate.toUpperCase()}
          </Button>
        );
      })}
    </div>
  );
}
