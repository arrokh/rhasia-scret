"use client";

import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmationDialog } from "@/shared/presentation/confirmation-dialog";
import { FormFieldError } from "@/shared/presentation/form-field-error";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { clearAllOfflineVaultData, requestLocalVaultLock } from "@/modules/sync";
import { DESTRUCTIVE_RESET_CONFIRMATION } from "../application/destructive-personal-vault-reset";
import { useDestructivePersonalVaultResetMutation } from "./hooks/use-personal-vault-mutations";

type Status = "idle" | "confirming" | "resetting" | "invalid_confirmation" | "blocked" | "reset_error" | "cleanup_error";

export function DestructivePersonalVaultResetForm() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [blockedVaults, setBlockedVaults] = useState(0);
  const resetMutation = useDestructivePersonalVaultResetMutation();
  const form = useForm({ defaultValues: { confirmation: "" }, onSubmit: () => setStatus("confirming") });

  async function confirmReset() {
    setStatus("resetting");
    let resetCompleted = false;
    try {
      const result = await resetMutation.mutateAsync(form.state.values.confirmation);
      if (result.status === "invalid_confirmation") { setStatus("invalid_confirmation"); return; }
      if (result.status === "owned_shared_vaults_exist") { setBlockedVaults(result.count); setStatus("blocked"); return; }
      if (result.status === "passkey_recovery_available") { router.refresh(); return; }
      resetCompleted = true;
      requestLocalVaultLock();
      await clearAllOfflineVaultData();
      router.replace("/vaults"); router.refresh();
    } catch { setStatus(resetCompleted ? "cleanup_error" : "reset_error"); }
  }

  return <form noValidate className="grid gap-5" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
    <StatusBanner tone="danger" title="Hapus data terenkripsi dan mulai ulang" role="alert">
      <p>Ini bukan pemulihan. Tindakan ini tidak dapat dibatalkan dan akan:</p>
      <ul className="mt-2 list-disc space-y-1 pl-5"><li>menghapus seluruh akun autentikator di Brankas Pribadi;</li><li>menghapus kunci dan ciphertext yang tidak lagi dapat dibuka;</li><li>mengeluarkan Anda dari Brankas Bersama tempat Anda menjadi Viewer; dan</li><li>mengharuskan Anda mereset 2FA pada layanan asli dan menambahkannya kembali.</li></ul>
      <p className="mt-2">Brankas Bersama milik orang lain dan data anggotanya tidak akan dihapus. Salinan atau secret yang sudah diperoleh browser lain tidak dapat dihapus dari jarak jauh.</p>
    </StatusBanner>
    <form.Field name="confirmation" validators={{ onSubmit: ({ value }) => value === DESTRUCTIVE_RESET_CONFIRMATION ? undefined : "Frasa konfirmasi tidak cocok." }}>{(field) => <div className="grid gap-2"><Label htmlFor="destructive-reset-confirmation" className="block leading-5">Ketik <strong>{DESTRUCTIVE_RESET_CONFIRMATION}</strong> untuk melanjutkan</Label><Input id="destructive-reset-confirmation" value={field.state.value} onChange={(event) => { field.handleChange(event.target.value); if (status !== "resetting") setStatus("idle"); }} autoComplete="off" aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "destructive-reset-confirmation-error" : undefined} disabled={status === "resetting"} required /><FormFieldError id="destructive-reset-confirmation-error" errors={field.state.meta.errors} /></div>}</form.Field>
    <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <Button variant="destructive" type="submit" disabled={isSubmitting} aria-busy={isSubmitting}><Trash2 />{isSubmitting ? "Menghapus data brankas…" : "Hapus data dan atur ulang brankas"}</Button>}</form.Subscribe>
    {status === "invalid_confirmation" && <StatusBanner tone="danger" role="alert">Server menolak frasa konfirmasi. Ketik frasa persis seperti yang ditampilkan.</StatusBanner>}
    {status === "blocked" && <StatusBanner tone="danger" role="alert">Reset diblokir karena Anda masih memiliki {blockedVaults} Brankas Bersama aktif.</StatusBanner>}
    {status === "reset_error" && <StatusBanner tone="danger" role="alert">Data brankas tidak dapat diatur ulang. Coba lagi.</StatusBanner>}
    {status === "cleanup_error" && <StatusBanner tone="danger" role="alert">Reset server selesai dan brankas telah dikunci, tetapi data perangkat tidak dapat dibersihkan. Hapus data situs browser ini sebelum melanjutkan.</StatusBanner>}
    {status === "confirming" && <ConfirmationDialog title="Atur ulang Brankas Pribadi?" description="Seluruh akun, kunci, dan data terenkripsi Brankas Pribadi akan dihancurkan. Tindakan ini tidak dapat dibatalkan." confirmLabel="Hapus dan atur ulang" danger onCancel={() => setStatus("idle")} onConfirm={() => void confirmReset()} />}
  </form>;
}
