"use client";

import { useState } from "react";
import { useForm } from "@tanstack/react-form";
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
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const terminateMutation = useTerminateSessionMutation();
  const form = useForm({ defaultValues: {}, onSubmit: () => { setError(""); setConfirming(true); } });

  async function confirmLogout() {
    setError("");
    try {
      window.location.assign(await terminateMutation.mutateAsync());
    } catch {
      setConfirming(false);
      setError("Tidak dapat keluar. Coba lagi.");
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" type="button" aria-label="Pengaturan akun" title="Pengaturan akun">
            <Settings aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72 rounded-md border-border bg-popover p-2 shadow-card">
          <DropdownMenuLabel className="flex items-center gap-3 px-2 py-2 normal-case">
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-foreground" aria-hidden="true"><UserRound className="size-5" /></span>
            <span className="grid min-w-0 gap-0.5">
              <span className="text-xs font-bold tracking-wide text-muted-foreground uppercase">Profil</span>
              <span className="truncate text-sm font-bold text-foreground">{email ?? "Akun pengguna"}</span>
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <form onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button variant="ghost" className="w-full justify-start text-destructive hover:bg-danger-surface hover:text-destructive" type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
                  <LogOut aria-hidden="true" />{isSubmitting ? "Keluar…" : "Keluar"}
                </Button>
              )}
            </form.Subscribe>
          </form>
          {error && <div className="mt-2"><StatusBanner tone="danger" role="alert">{error}</StatusBanner></div>}
        </DropdownMenuContent>
      </DropdownMenu>
      {confirming && (
        <ConfirmationDialog title="Keluar dari aplikasi?" description="Sesi brankas yang sedang terbuka akan ditutup dan Anda perlu membukanya kembali setelah masuk." confirmLabel="Keluar" danger pending={terminateMutation.isPending} onCancel={() => setConfirming(false)} onConfirm={() => void confirmLogout()} />
      )}
    </>
  );
}
