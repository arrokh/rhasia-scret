"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "next/navigation";
import { ConfirmationDialog } from "@/shared/presentation/confirmation-dialog";
import { FormFieldError } from "@/shared/presentation/form-field-error";
import { forgetRememberedBrowser, removeAllEncryptedLocalVaultSnapshots } from "@/modules/crypto";
import { DESTRUCTIVE_RESET_CONFIRMATION } from "../application/destructive-personal-vault-reset";
import { useDestructivePersonalVaultResetMutation } from "./hooks/use-personal-vault-mutations";

type Status = "idle" | "confirming" | "resetting" | "invalid_confirmation" | "blocked" | "reset_error";

export function DestructivePersonalVaultResetForm() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [blockedVaults, setBlockedVaults] = useState(0);
  const resetMutation = useDestructivePersonalVaultResetMutation();
  const form = useForm({
    defaultValues: { confirmation: "" },
    onSubmit: () => setStatus("confirming")
  });

  async function confirmReset() {
    setStatus("resetting");
    try {
        const result = await resetMutation.mutateAsync(form.state.values.confirmation);
        if (result.status === "invalid_confirmation") {
          setStatus("invalid_confirmation");
          return;
        }
        if (result.status === "owned_shared_vaults_exist") {
          setBlockedVaults(result.count);
          setStatus("blocked");
          return;
        }
        if (result.status === "passkey_recovery_available") {
          router.refresh();
          return;
        }
        forgetRememberedBrowser();
        removeAllEncryptedLocalVaultSnapshots();
        router.replace("/vaults");
        router.refresh();
    } catch {
      setStatus("reset_error");
    }
  }

  return (
    <form noValidate className="auth-form destructive-reset-form" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
      <div className="destructive-warning" role="alert">
        <h2>Hapus data terenkripsi dan mulai ulang</h2>
        <p>Ini bukan pemulihan. Tindakan ini tidak dapat dibatalkan dan akan:</p>
        <ul>
          <li>menghapus seluruh akun autentikator di Brankas Pribadi;</li>
          <li>menghapus kunci dan ciphertext yang tidak lagi dapat dibuka;</li>
          <li>mengeluarkan Anda dari Brankas Bersama tempat Anda menjadi Viewer; dan</li>
          <li>mengharuskan Anda mereset 2FA pada layanan asli dan menambahkannya kembali.</li>
        </ul>
        <p>Brankas Bersama milik orang lain dan data anggotanya tidak akan dihapus. Salinan atau secret yang sudah diperoleh browser lain tidak dapat dihapus dari jarak jauh.</p>
      </div>
      <form.Field
        name="confirmation"
        validators={{ onSubmit: ({ value }) => value === DESTRUCTIVE_RESET_CONFIRMATION ? undefined : "Frasa konfirmasi tidak cocok." }}
      >
        {(field) => (
          <>
            <label htmlFor="destructive-reset-confirmation">Ketik <strong>{DESTRUCTIVE_RESET_CONFIRMATION}</strong> untuk melanjutkan</label>
            <input
              id="destructive-reset-confirmation"
              value={field.state.value}
              onChange={(event) => { field.handleChange(event.target.value); if (status !== "resetting") setStatus("idle"); }}
              autoComplete="off"
              aria-invalid={field.state.meta.errors.length > 0}
              aria-describedby={field.state.meta.errors.length ? "destructive-reset-confirmation-error" : undefined}
              disabled={status === "resetting"}
              required
            />
            <FormFieldError id="destructive-reset-confirmation-error" errors={field.state.meta.errors} />
          </>
        )}
      </form.Field>
      <form.Subscribe selector={(formState) => formState.isSubmitting}>
        {(isSubmitting) => <button className="danger-button" type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>{isSubmitting ? "Menghapus data brankas…" : "Hapus data dan atur ulang brankas"}</button>}
      </form.Subscribe>
      {status !== "resetting" && <Link className="secondary-link" href="/vaults">Batal dan kembali</Link>}
      {status === "invalid_confirmation" && <p className="form-status" role="alert">Server menolak frasa konfirmasi. Ketik frasa persis seperti yang ditampilkan.</p>}
      {status === "blocked" && <p className="form-status" role="alert">Reset diblokir karena Anda masih memiliki {blockedVaults} Brankas Bersama aktif.</p>}
      {status === "reset_error" && <p className="form-status" role="alert">Data brankas tidak dapat diatur ulang. Coba lagi.</p>}
      {status === "confirming" && (
        <ConfirmationDialog
          title="Atur ulang Brankas Pribadi?"
          description="Seluruh akun, kunci, dan data terenkripsi Brankas Pribadi akan dihancurkan. Tindakan ini tidak dapat dibatalkan."
          confirmLabel="Hapus dan atur ulang"
          danger
          onCancel={() => setStatus("idle")}
          onConfirm={() => void confirmReset()}
        />
      )}
    </form>
  );
}
