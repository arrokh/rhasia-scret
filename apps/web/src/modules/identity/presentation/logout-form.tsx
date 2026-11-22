"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useTranslations } from "next-intl";
import { Lock, LogOut, Settings, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmationDialog } from "@/shared/presentation/confirmation-dialog";
import { LocaleChangeConfirmation, LocaleSwitcher } from "@/i18n/locale-switcher";
import type { AppLocale } from "@/i18n/config";
import { useTerminateSessionMutation } from "./hooks/use-session-mutations";

export function LogoutForm({
  email,
  lockLabel,
  onLock,
  navigate,
}: {
  email?: string;
  lockLabel?: string;
  onLock?: () => void;
  navigate?: (path: string) => void;
}) {
  const t = useTranslations("Identity.logout");
  const [confirming, setConfirming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [localeToConfirm, setLocaleToConfirm] = useState<AppLocale | null>(null);
  const terminateMutation = useTerminateSessionMutation();
  const form = useForm({
    defaultValues: {},
    onSubmit: () => setConfirming(true),
  });

  function navigateTo(path: string) {
    if (navigate) {
      navigate(path);
      return;
    }
    window.location.assign(path);
  }

  async function confirmLogout() {
    try {
      navigateTo(await terminateMutation.mutateAsync());
    } catch {
      navigateTo("/sign-in?auth=logout_failed");
    }
  }

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" type="button" aria-label={t("settings")} title={t("settings")}>
            <Settings aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72 rounded-md border-border bg-popover p-2 shadow-card">
          <DropdownMenuLabel className="flex items-center gap-3 px-2 py-2 normal-case">
            <span
              className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-foreground"
              aria-hidden="true"
            >
              <UserRound className="size-5" />
            </span>
            <span className="grid min-w-0 gap-0.5">
              <span className="text-xs font-bold tracking-wide text-muted-foreground uppercase">{t("profile")}</span>
              <span className="truncate text-sm font-bold text-foreground">{email ?? t("userAccount")}</span>
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <LocaleSwitcher
            embedded
            onLocaleRequested={(locale) => {
              setMenuOpen(false);
              setLocaleToConfirm(locale);
            }}
          />
          <DropdownMenuSeparator />
          <Button
            variant="ghost"
            className="w-full justify-start text-destructive hover:bg-danger-surface hover:text-destructive"
            type="button"
            asChild
          >
            <Link href="/account/delete" onClick={() => setMenuOpen(false)}>
              <Trash2 aria-hidden="true" />
              {t("deleteAccount")}
            </Link>
          </Button>
          {lockLabel && onLock && (
            <Button
              variant="ghost"
              className="w-full justify-start"
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onLock();
              }}
            >
              <Lock aria-hidden="true" />
              {lockLabel}
            </Button>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
          >
            <form.Subscribe<boolean> selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button
                  variant="ghost"
                  className="w-full justify-start text-destructive hover:bg-danger-surface hover:text-destructive"
                  type="submit"
                  disabled={isSubmitting}
                  aria-busy={isSubmitting}
                >
                  <LogOut aria-hidden="true" />
                  {isSubmitting ? t("leaving") : t("leave")}
                </Button>
              )}
            </form.Subscribe>
          </form>
        </DropdownMenuContent>
      </DropdownMenu>
      {confirming && (
        <ConfirmationDialog
          title={t("confirmTitle")}
          description={t("confirmDescription")}
          confirmLabel={t("leave")}
          danger
          pending={terminateMutation.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void confirmLogout()}
        />
      )}
      {localeToConfirm && (
        <LocaleChangeConfirmation nextLocale={localeToConfirm} onCancel={() => setLocaleToConfirm(null)} />
      )}
    </>
  );
}
