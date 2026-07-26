"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Fingerprint, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { useOnlineStatus } from "@/shared/presentation/use-online-status";
import { enrollRememberedBrowser, forgetRememberedBrowser, rememberedBrowserEnrollment, supportsLocalVerification } from "../infrastructure/browser-local-verification";

export function RememberedBrowserEnrollment({ profileId, userRootKey }: { profileId: string; userRootKey: Uint8Array }) {
  const online = useOnlineStatus();
  const [status, setStatus] = useState<"checking" | "idle" | "enrolled" | "removed" | "unsupported" | "cancelled" | "offline" | "error">("checking");
  const [enrolledAt, setEnrolledAt] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const enrollmentOperationRef = useRef<AbortController | null>(null);
  const form = useForm({
    defaultValues: {},
    onSubmit: async () => {
      if (!online) { setStatus("offline"); return; }
      if (!supportsLocalVerification()) { setStatus("unsupported"); return; }
      setStatus("idle");
      const controller = new AbortController();
      enrollmentOperationRef.current?.abort();
      enrollmentOperationRef.current = controller;
      try {
        await enrollRememberedBrowser(profileId, userRootKey, controller.signal);
        if (controller.signal.aborted) return;
        setEnrolledAt(new Date().toISOString());
        setStatus("enrolled");
      } catch (error) {
        if (!controller.signal.aborted) setStatus(enrollmentFailureStatus(error));
      } finally {
        if (enrollmentOperationRef.current === controller) enrollmentOperationRef.current = null;
      }
    }
  });

  useEffect(() => {
    let active = true;
    rememberedBrowserEnrollment(profileId)
      .then((enrollment) => {
        if (!active) return;
        setEnrolledAt(enrollment?.enrolledAt ?? null);
        setStatus("idle");
      })
      .catch(() => { if (active) setStatus("error"); });
    return () => { active = false; enrollmentOperationRef.current?.abort(); };
  }, [profileId]);

  async function remove() {
    enrollmentOperationRef.current?.abort();
    setRemoving(true);
    try {
      await forgetRememberedBrowser(profileId);
      setEnrolledAt(null);
      setStatus("removed");
    } catch {
      setStatus("error");
    } finally {
      setRemoving(false);
    }
  }

  return <div className="grid gap-3 border-t border-border pt-4">
    <div><h3 className="font-bold text-foreground">Browser yang Diingat</h3><p className="mt-1 text-sm text-muted-foreground">Lindungi salinan User Root Key lokal dengan Verifikasi Lokal WebAuthn PRF. Ini hanya membuka brankas setelah autentikasi aplikasi; bukan MFA atau Passkey-Assisted Recovery.</p></div>
    <p className="text-xs leading-5 text-muted-foreground">Berlaku hanya untuk profil browser dan situs ini. Mode privat serta webview tertanam tidak didukung. Passphrase Brankas tetap menjadi jalur cadangan.</p>
    {enrolledAt && <StatusBanner tone="success">Browser ini diingat sejak {new Date(enrolledAt).toLocaleString("id-ID")}.</StatusBanner>}
    <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
      <form.Subscribe selector={(state) => state.isSubmitting}>{(pending) => <><Button type="submit" variant="outline" disabled={!online || pending || removing || status === "checking"} aria-busy={pending}><Fingerprint />{pending ? "Memverifikasi…" : enrolledAt ? "Perbarui Verifikasi Lokal" : "Ingat browser ini"}</Button>{enrolledAt && <Button type="button" variant="ghost" className="text-destructive" disabled={removing || pending} aria-busy={removing} onClick={() => void remove()}><Trash2 />{removing ? "Menghapus…" : "Lupakan browser ini"}</Button>}</>}</form.Subscribe>
    </form>
    {status === "enrolled" && <StatusBanner tone="success">Browser ini dapat memakai Verifikasi Lokal untuk membuka material terenkripsi.</StatusBanner>}
    {status === "removed" && <StatusBanner tone="success">Paket Browser yang Diingat telah dihapus dari profil ini. Kredensial autentikator mungkin tetap terlihat di pengelola passkey perangkat.</StatusBanner>}
    {status === "cancelled" && <StatusBanner tone="warning">Enrollment Browser yang Diingat dibatalkan. Tidak ada paket lokal yang disimpan.</StatusBanner>}
    {status === "offline" && <StatusBanner tone="offline">Hubungkan perangkat sebelum mengingat browser ini. Enrollment luring tidak didukung.</StatusBanner>}
    {status === "unsupported" && <StatusBanner tone="warning">Browser atau autentikator ini tidak mendukung perlindungan PRF. Gunakan Passphrase Brankas.</StatusBanner>}
    {status === "error" && <StatusBanner tone="danger" role="alert">Pengaturan Browser yang Diingat gagal. Tidak ada kunci lokal tanpa perlindungan yang disimpan.</StatusBanner>}
  </div>;
}

function enrollmentFailureStatus(error: unknown): "cancelled" | "unsupported" | "error" {
  const message = error instanceof Error ? error.message : "";
  if (/dibatalkan|cancelled|NotAllowedError/i.test(message)) return "cancelled";
  if (/PRF|tidak mendukung|does not support/i.test(message)) return "unsupported";
  return "error";
}
