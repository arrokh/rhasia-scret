"use client";

import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useTranslations } from "next-intl";
import { LogOut, Settings, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { ConfirmationDialog } from "@/shared/presentation/confirmation-dialog";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { useTerminateSessionMutation } from "./hooks/use-session-mutations";

export function LogoutForm({ email }: { email?: string }) {
  const t = useTranslations("Identity.logout");
  const [error, setError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const terminateMutation = useTerminateSessionMutation();
  const form = useForm({ defaultValues: {}, onSubmit: () => { setError(false); setConfirming(true); } });

  async function confirmLogout() {
    setError(false);
    try {
      window.location.assign(await terminateMutation.mutateAsync());
    } catch {
      setConfirming(false);
      setError(true);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" type="button" aria-label={t("settings")} title={t("settings")}>
            <Settings aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72 rounded-md border-border bg-popover p-2 shadow-card">
          <DropdownMenuLabel className="flex items-center gap-3 px-2 py-2 normal-case">
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-foreground" aria-hidden="true"><UserRound className="size-5" /></span>
            <span className="grid min-w-0 gap-0.5">
              <span className="text-xs font-bold tracking-wide text-muted-foreground uppercase">{t("profile")}</span>
              <span className="truncate text-sm font-bold text-foreground">{email ?? t("userAccount")}</span>
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <form onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button variant="ghost" className="w-full justify-start text-destructive hover:bg-danger-surface hover:text-destructive" type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
                  <LogOut aria-hidden="true" />{isSubmitting ? t("leaving") : t("leave")}
                </Button>
              )}
            </form.Subscribe>
          </form>
          {error && <div className="mt-2"><StatusBanner tone="danger" role="alert">{t("cleanupError")}</StatusBanner></div>}
        </DropdownMenuContent>
      </DropdownMenu>
      {confirming && (
        <ConfirmationDialog title={t("confirmTitle")} description={t("confirmDescription")} confirmLabel={t("leave")} danger pending={terminateMutation.isPending} onCancel={() => setConfirming(false)} onConfirm={() => void confirmLogout()} />
      )}
    </>
  );
}
