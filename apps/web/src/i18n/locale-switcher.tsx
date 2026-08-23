"use client";

import { useLayoutEffect, useRef, useState, useTransition } from "react";
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
  const fitEmbeddedMenuRef = useRef<() => void>(() => {});
  const activeLanguage = languageName(locale, t);

  useLayoutEffect(() => {
    // Radix submenus open sideways; shift the embedded language menu when the settings menu leaves no horizontal room.
    if (!embedded || !document.body) return;
    let positionedWrapper: HTMLElement | null = null;
    let positionObserver: MutationObserver | null = null;
    let settleFrame: number | null = null;
    let settleFramesRemaining = 0;
    const positionObserverOptions: MutationObserverInit = { attributes: true, attributeFilter: ["style"] };
    const cancelSettle = () => {
      if (settleFrame !== null) cancelAnimationFrame(settleFrame);
      settleFrame = null;
      settleFramesRemaining = 0;
    };
    const fitWithinViewport = () => {
      const content = document.querySelector<HTMLElement>('[data-slot="dropdown-menu-sub-content"]');
      const wrapper = content?.parentElement;
      if (!content || !wrapper) return;
      const [currentShiftX = 0, currentShiftY = 0] = wrapper.style.translate.split(/\s+/).map((value) => Number.parseFloat(value) || 0);
      if (Math.abs(currentShiftX) > 0.1 || Math.abs(currentShiftY) > 0.1) {
        positionObserver?.disconnect();
        wrapper.style.translate = "";
      }
      const box = content.getBoundingClientRect();
      const minimum = 8;
      const maximum = window.innerWidth - minimum - box.width;
      const horizontalShift = Math.min(Math.max(minimum - box.left, 0), maximum - box.left);
      const nextShiftX = Math.abs(horizontalShift) > 0.5 ? horizontalShift : 0;
      const trigger = document.querySelector<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]');
      const triggerBox = trigger?.getBoundingClientRect();
      const overlapsTrigger = triggerBox && box.top < triggerBox.bottom && box.bottom > triggerBox.top;
      const verticalShift = nextShiftX !== 0 && overlapsTrigger ? triggerBox.bottom + minimum - box.top : 0;
      const nextShiftY = Math.abs(verticalShift) > 0.5 ? verticalShift : 0;
      if (Math.abs(currentShiftX - nextShiftX) <= 0.1 && Math.abs(currentShiftY - nextShiftY) <= 0.1 && Math.abs(currentShiftX) <= 0.1 && Math.abs(currentShiftY) <= 0.1) return;
      positionObserver?.disconnect();
      wrapper.style.translate = nextShiftX || nextShiftY ? `${nextShiftX}px ${nextShiftY}px` : "";
      positionObserver?.observe(wrapper, positionObserverOptions);
    };
    fitEmbeddedMenuRef.current = fitWithinViewport;
    const settlePosition = () => {
      settleFrame = null;
      if (!positionedWrapper) return;
      fitWithinViewport();
      settleFramesRemaining -= 1;
      if (settleFramesRemaining > 0) settleFrame = requestAnimationFrame(settlePosition);
    };
    const scheduleSettle = () => {
      cancelSettle();
      settleFramesRemaining = 8;
      settleFrame = requestAnimationFrame(settlePosition);
    };
    const observePosition = () => {
      const content = document.querySelector<HTMLElement>('[data-slot="dropdown-menu-sub-content"]');
      const wrapper = content?.parentElement ?? null;
      if (wrapper === positionedWrapper) return;
      cancelSettle();
      positionObserver?.disconnect();
      positionedWrapper = wrapper;
      if (!wrapper) return;
      positionObserver = new MutationObserver(fitWithinViewport);
      positionObserver.observe(wrapper, positionObserverOptions);
      fitWithinViewport();
      scheduleSettle();
    };
    const handleResize = () => {
      fitWithinViewport();
      scheduleSettle();
    };

    const observer = new MutationObserver(observePosition);
    observer.observe(document.body, { childList: true, subtree: true });
    observePosition();
    window.addEventListener("resize", handleResize);
    return () => {
      observer.disconnect();
      cancelSettle();
      positionObserver?.disconnect();
      window.removeEventListener("resize", handleResize);
      fitEmbeddedMenuRef.current = () => {};
    };
  }, [embedded]);

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
        <DropdownMenuSubContent collisionPadding={8} onAnimationEnd={() => fitEmbeddedMenuRef.current()} className="w-56 rounded-md border-border bg-popover p-2 shadow-card" style={{ width: "min(14rem, calc(100vw - 1rem))" }} aria-label={t("options")}>{options}</DropdownMenuSubContent>
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
