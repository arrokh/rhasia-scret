"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, Fingerprint, LoaderCircle, RefreshCw, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePasskeyRecoveryStatusQuery, useRemovePasskeyRecoveryMutation } from "@/modules/identity";
import { BrowserApiError } from "@/shared/infrastructure/browser-api-client";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { ConfirmationDialog } from "@/shared/presentation/confirmation-dialog";
import { enrollPasskeyRecovery } from "../infrastructure/browser-passkey-recovery-workflow";

export function PasskeyRecoveryEnrollment({ userRootKey }: { userRootKey: Uint8Array }) {
  const recoveryStatus = usePasskeyRecoveryStatusQuery();
  const removeRecovery = useRemovePasskeyRecoveryMutation();
  const [status, setStatus] = useState<"idle" | "enrolling" | "success" | "error" | "removed" | "removal_error">("idle");
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function enroll() {
    setStatus("enrolling");
    setErrorMessage("");
    try {
      await enrollPasskeyRecovery(userRootKey);
      setStatus("success");
      await recoveryStatus.refetch();
    } catch (reason) {
      setErrorMessage(passkeyRecoveryEnrollmentErrorMessage(reason));
      setStatus("error");
    }
  }

  async function detach() {
    try {
      await removeRecovery.mutateAsync();
      setConfirmingRemoval(false);
      setStatus("removed");
    } catch {
      setConfirmingRemoval(false);
      setStatus("removal_error");
    }
  }

  const enrolled = recoveryStatus.data?.enrolled === true;
  return <section className="grid gap-4">
    <div className="grid justify-items-center gap-3 text-center">
      <span className={`grid size-14 place-items-center rounded-xl ${enrolled ? "bg-success-surface text-success" : "bg-gold-soft text-ink-strong"}`}>
        {enrolled ? <CheckCircle2 className="size-7" /> : <Fingerprint className="size-7" />}
      </span>
      <p className="text-sm leading-6 text-muted-foreground">Pemulihan kunci akses melindungi paket pemulihan terenkripsi. Layanan tidak pernah menerima kunci brankas yang dapat digunakan.</p>
    </div>

    {recoveryStatus.isPending ? (
      <Button disabled aria-busy="true"><LoaderCircle className="animate-spin" />Memeriksa status pemulihan…</Button>
    ) : recoveryStatus.isError ? (
      <>
        <StatusBanner tone="danger" role="alert" title="Status pemulihan tidak dapat dimuat">Jangan membuat passkey baru sampai status saat ini berhasil diperiksa.</StatusBanner>
        <Button variant="outline" type="button" onClick={() => void recoveryStatus.refetch()}><RefreshCw />Periksa kembali</Button>
      </>
    ) : enrolled ? (
      <>
        <StatusBanner tone="success" title="Pemulihan kunci akses aktif">Passkey pemulihan sudah tersimpan. Anda tidak perlu mengaktifkannya lagi.</StatusBanner>
        <p className="text-sm leading-6 text-muted-foreground">Jika lupa Passphrase Brankas, pilih <strong>Lupa Passphrase Brankas?</strong> pada layar pembukaan brankas. Verifikasi passkey ini untuk membuat passphrase baru tanpa mengirim kunci ke server.</p>
        <Button variant="outline" asChild><Link href="/vaults/recovery">Buka halaman pemulihan</Link></Button>
        <Button variant="destructive" type="button" onClick={() => { setStatus("idle"); setConfirmingRemoval(true); }}><Unlink />Hapus pemulihan kunci akses</Button>
      </>
    ) : (
      <Button type="button" onClick={() => void enroll()} disabled={status === "enrolling"} aria-busy={status === "enrolling"}>
        {status === "enrolling" && <LoaderCircle className="animate-spin" />}
        {status === "enrolling" ? "Membuat pemulihan…" : "Aktifkan pemulihan kunci akses"}
      </Button>
    )}

    {!enrolled && status === "success" && <StatusBanner tone="success">Pemulihan kunci akses diaktifkan. Status sedang diperbarui.</StatusBanner>}
    {!enrolled && status === "removed" && <StatusBanner tone="success">Pemulihan kunci akses telah dihapus. Passphrase Brankas tetap dapat digunakan.</StatusBanner>}
    {status === "error" && <StatusBanner tone="danger" role="alert" title="Pemulihan tidak dapat diaktifkan">{errorMessage}</StatusBanner>}
    {status === "removal_error" && <StatusBanner tone="danger" role="alert" title="Pemulihan tidak dapat dihapus">Status pemulihan tidak berubah. Periksa koneksi lalu coba lagi.</StatusBanner>}
    {confirmingRemoval && <ConfirmationDialog title="Hapus pemulihan kunci akses?" description="Passkey ini tidak lagi dapat memulihkan atau membuka brankas. Passphrase Brankas tetap berlaku. Entri passkey mungkin masih perlu dihapus secara terpisah dari pengelola passkey perangkat Anda." confirmLabel="Hapus pemulihan" danger pending={removeRecovery.isPending} onCancel={() => setConfirmingRemoval(false)} onConfirm={() => void detach()} />}
  </section>;
}

export function passkeyRecoveryEnrollmentErrorMessage(reason: unknown): string {
  if (reason instanceof BrowserApiError) {
    if (reason.code === "passkey_prf_required") return "Passkey yang dipilih tidak mendukung PRF. Gunakan passkey perangkat dari Chrome atau Edge terbaru, lalu coba lagi.";
    if (reason.code === "passkey_challenge_expired") return "Sesi pendaftaran passkey telah kedaluwarsa. Mulai kembali proses aktivasi.";
    if (reason.code === "passkey_verification_failed") return "Passkey tidak dapat diverifikasi. Pastikan aplikasi dibuka dari origin yang dikonfigurasi, lalu coba lagi.";
    if (reason.code === "passkey_recovery_unavailable" || reason.status === 503) return "Layanan pemulihan belum dikonfigurasi atau sementara tidak tersedia.";
    if (reason.code === "unauthenticated") return "Sesi masuk Anda telah berakhir. Masuk kembali sebelum mengaktifkan pemulihan.";
  }
  if (reason instanceof DOMException) {
    if (reason.name === "InvalidStateError") return "Passkey pemulihan sudah terdaftar pada perangkat ini. Periksa kembali status pemulihan sebelum membuat yang baru.";
    if (reason.name === "NotAllowedError" || reason.name === "AbortError") return "Pembuatan passkey dibatalkan atau waktunya habis. Coba lagi dan selesaikan verifikasi perangkat.";
    if (reason.name === "SecurityError") return "Origin aplikasi tidak cocok dengan konfigurasi passkey. Gunakan alamat aplikasi yang benar dan pastikan HTTPS aktif di produksi.";
    if (reason.name === "NotSupportedError") return "Browser atau pengelola passkey ini tidak mendukung WebAuthn PRF.";
  }
  if (reason instanceof Error && reason.message.includes("does not support PRF")) return "Passkey yang dipilih tidak mendukung PRF. Gunakan passkey perangkat dari Chrome atau Edge terbaru.";
  return "Pemulihan tidak dapat diaktifkan karena kesalahan yang tidak dikenal. Periksa koneksi, status pemulihan, dan dukungan passkey perangkat.";
}
