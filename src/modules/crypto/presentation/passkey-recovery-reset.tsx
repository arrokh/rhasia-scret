"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { FormFieldError } from "@/shared/presentation/form-field-error";
import { resetVaultUnlockSecretWithPasskey } from "../infrastructure/browser-passkey-recovery-workflow";
import { generateVaultUnlockSecret } from "./generate-vault-unlock-secret";

type Status = "idle" | "recovering" | "recovery_error" | "success";

export function PasskeyRecoveryReset() {
  const generatedSecret = useRef<string | null>(null);
  const [secret, setSecret] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const form = useForm({
    defaultValues: { confirmation: "", acknowledged: false },
    onSubmit: async ({ value }) => reset(value.confirmation)
  });

  useEffect(() => {
    generatedSecret.current ??= generateVaultUnlockSecret();
    setSecret(generatedSecret.current);
  }, []);

  function regenerateSecret() {
    const nextSecret = generateVaultUnlockSecret();
    generatedSecret.current = nextSecret;
    setSecret(nextSecret);
    form.reset();
    setStatus("idle");
  }

  async function reset(confirmation: string) {
    if (!secret || confirmation.trim() !== secret) return;
    setStatus("recovering");
    try {
      await resetVaultUnlockSecretWithPasskey(secret);
      setStatus("success");
    } catch {
      setStatus("recovery_error");
    }
  }

  return (
    <form noValidate className="auth-form vault-recovery-form" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
      <p className="vault-flow-title">Atur ulang Passphrase Brankas</p>
      <p className="vault-flow-copy">Gunakan kunci akses pemulihan yang telah Anda daftarkan. Pemulihan dan pembungkusan ulang kunci dilakukan hanya di browser ini.</p>
      <label htmlFor="recovery-new-secret">Passphrase Brankas baru</label>
      <output id="recovery-new-secret" className="generated-passphrase" aria-label="Passphrase Brankas baru">{secret || "Membuat passphrase…"}</output>
      <button className="secondary-button" type="button" disabled={!secret || status === "recovering" || status === "success"} onClick={regenerateSecret}>Buat passphrase lain</button>
      <form.Field
        name="confirmation"
        validators={{ onSubmit: ({ value }) => value.trim() === secret ? undefined : "Konfirmasi harus cocok dengan passphrase baru." }}
      >
        {(field) => <><label htmlFor="recovery-secret-confirmation">Masukkan kembali passphrase baru</label><input id="recovery-secret-confirmation" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} autoComplete="off" aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "recovery-confirmation-error" : undefined} disabled={status === "recovering" || status === "success"} required /><FormFieldError id="recovery-confirmation-error" errors={field.state.meta.errors} /></>}
      </form.Field>
      <form.Field name="acknowledged" validators={{ onSubmit: ({ value }) => value ? undefined : "Konfirmasikan bahwa passphrase baru telah disimpan secara luring." }}>
        {(field) => <><label className="checkbox-label"><input type="checkbox" checked={field.state.value} onChange={(event) => field.handleChange(event.target.checked)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "recovery-acknowledgement-error" : undefined} disabled={status === "recovering" || status === "success"} required /> <span>Saya telah menyimpan passphrase baru secara luring.</span></label><FormFieldError id="recovery-acknowledgement-error" errors={field.state.meta.errors} /></>}
      </form.Field>
      <form.Subscribe selector={(formState) => formState.isSubmitting}>
        {(isSubmitting) => <button className="primary-button" type="submit" disabled={!secret || isSubmitting || status === "success"} aria-busy={isSubmitting}>{isSubmitting ? "Memverifikasi kunci akses…" : "Atur ulang passphrase"}</button>}
      </form.Subscribe>
      {status !== "recovering" && <Link className="secondary-link" href="/vaults">Kembali ke pembukaan brankas</Link>}
      {status === "recovery_error" && <p className="form-status" role="alert">Passphrase tidak dapat diatur ulang. Pastikan kunci akses pemulihan tersedia dan coba lagi.</p>}
      {status === "success" && <p className="form-status" role="status">Passphrase berhasil diatur ulang. Simpan passphrase baru di atas, lalu gunakan untuk membuka brankas.</p>}
    </form>
  );
}
