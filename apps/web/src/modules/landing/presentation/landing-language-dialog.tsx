"use client";

import { useLayoutEffect, useRef, useState, useTransition } from "react";
import { LoaderCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { applyLocalePreference } from "@/i18n/locale-switcher";
import { isAppLocale, localeCookieName, type AppLocale } from "@/i18n/config";
import { useOnlineStatus } from "@/shared/presentation/use-online-status";

export function LandingLanguageDialog({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const locale = useLocale();
  const router = useRouter();
  const online = useOnlineStatus();
  const t = useTranslations("Home.landingLanguageChoice");
  const localeT = useTranslations("Locale");
  const commonT = useTranslations("Common");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [isRefreshing, startTransition] = useTransition();
  const selectedRef = useRef(false);
  const lastReportedOpenRef = useRef<boolean | null>(null);
  const onOpenChangeRef = useRef(onOpenChange);

  useLayoutEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  useLayoutEffect(() => {
    const nextOpen = online && requiresLandingLanguageChoice(document.cookie);
    if (lastReportedOpenRef.current === nextOpen) return;
    lastReportedOpenRef.current = nextOpen;
    setOpen(nextOpen);
    onOpenChangeRef.current?.(nextOpen);
  }, [online]);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen || selectedRef.current) setOpen(nextOpen);
  }

  async function chooseLocale(nextLocale: AppLocale) {
    if (!open || pending || (nextLocale !== locale && !online)) return;
    setRefreshFailed(false);
    setPending(true);
    const applied = await applyLocalePreference(nextLocale, locale, { firstChoice: true });
    setPending(false);
    if (!applied) {
      setRefreshFailed(true);
      return;
    }

    selectedRef.current = true;
    setOpen(false);
    lastReportedOpenRef.current = false;
    onOpenChangeRef.current?.(false);
    startTransition(() => router.refresh());
  }

  const disabledIndonesianChoice = !online && locale !== "id";
  const disabledEnglishChoice = !online && locale !== "en";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-landing-language-choice="true"
        className="max-h-[calc(100dvh-2rem)] max-w-sm overflow-y-auto rounded-lg border-border bg-card p-5 shadow-sheet"
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-xl leading-7 font-bold text-ink-strong">{t("title")}</DialogTitle>
          <DialogDescription className="leading-5">{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Button
            type="button"
            className="w-full justify-center"
            disabled={pending || isRefreshing || disabledIndonesianChoice}
            title={disabledIndonesianChoice ? localeT("offlineUnavailable") : undefined}
            aria-describedby={disabledIndonesianChoice ? "landing-language-choice-offline-status" : undefined}
            aria-busy={pending || isRefreshing}
            onClick={() => void chooseLocale("id")}
          >
            {pending || isRefreshing ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
            {localeT("indonesian")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full justify-center"
            disabled={pending || isRefreshing || disabledEnglishChoice}
            title={disabledEnglishChoice ? localeT("offlineUnavailable") : undefined}
            aria-describedby={disabledEnglishChoice ? "landing-language-choice-offline-status" : undefined}
            aria-busy={pending || isRefreshing}
            onClick={() => void chooseLocale("en")}
          >
            {pending || isRefreshing ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
            {localeT("english")}
          </Button>
        </div>
        {!online && (
          <p id="landing-language-choice-offline-status" role="status" className="text-sm text-muted-foreground">
            {t("offlineStatus")}
          </p>
        )}
        {refreshFailed && (
          <p role="alert" className="text-sm text-destructive">
            {localeT("offlineShellRefreshFailed")}
          </p>
        )}
        {pending && (
          <p role="status" className="sr-only">
            {commonT("processing")}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function requiresLandingLanguageChoice(cookieHeader: string): boolean {
  const localeCookie = cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.slice(0, cookie.indexOf("=")) === localeCookieName);
  if (!localeCookie) return true;

  return !isAppLocale(localeCookie.slice(localeCookie.indexOf("=") + 1));
}
