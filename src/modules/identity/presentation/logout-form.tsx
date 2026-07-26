"use client";

import { useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { ConfirmationDialog } from "@/shared/presentation/confirmation-dialog";
import { useTerminateSessionMutation } from "./hooks/use-session-mutations";

export function LogoutForm({ email }: { email?: string }) {
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const popover = useRef<HTMLDivElement>(null);
  const terminateMutation = useTerminateSessionMutation();
  const form = useForm({
    defaultValues: {},
    onSubmit: () => {
      setError("");
      setConfirming(true);
    }
  });

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
    <div className="account-menu">
      <button
        className="account-menu-trigger"
        type="button"
        popoverTarget="account-profile-menu"
        aria-label="Pengaturan akun"
        title="Pengaturan akun"
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          popover.current?.style.setProperty("--account-menu-top", `${bounds.bottom + 8}px`);
          popover.current?.style.setProperty("--account-menu-right", `${window.innerWidth - bounds.right}px`);
        }}
      ><SettingsIcon /></button>
      <div ref={popover} id="account-profile-menu" className="account-menu-popover" popover="auto">
        <div className="account-menu-profile">
          <span className="account-menu-profile-icon" aria-hidden="true"><UserIcon /></span>
          <span><small>Profil</small><strong>{email ?? "Akun pengguna"}</strong></span>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <button className="account-menu-logout" type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
                <LogoutIcon />
                {isSubmitting ? "Keluar…" : "Keluar"}
              </button>
            )}
          </form.Subscribe>
          {error && <p className="form-status" role="alert">{error}</p>}
          {confirming && (
            <ConfirmationDialog
              title="Keluar dari aplikasi?"
              description="Sesi brankas yang sedang terbuka akan ditutup dan Anda perlu membukanya kembali setelah masuk."
              confirmLabel="Keluar"
              danger
              pending={terminateMutation.isPending}
              onCancel={() => setConfirming(false)}
              onConfirm={() => void confirmLogout()}
            />
          )}
        </form>
      </div>
    </div>
  );
}

function SettingsIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.14.37.36.7.64.96.3.27.68.42 1.08.44H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z" /></svg>;
}
function UserIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 8a7 7 0 0 0-14 0" /></svg>; }
function LogoutIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 17l5-5-5-5M15 12H3m12-8h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /></svg>; }
