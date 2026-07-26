"use client";

import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { ConfirmationDialog } from "@/shared/presentation/confirmation-dialog";
import { useTerminateSessionMutation } from "./hooks/use-session-mutations";

export function LogoutForm() {
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
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
    <form onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <button className="logout-button" type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
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
  );
}
