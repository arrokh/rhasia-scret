"use client";

import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Fingerprint, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { enrollRememberedBrowser, forgetRememberedBrowser, supportsLocalVerification } from "../infrastructure/browser-local-verification";

export function RememberedBrowserEnrollment({ profileId, userRootKey }: { profileId: string; userRootKey: Uint8Array }) {
  const [status, setStatus] = useState<"idle" | "enrolled" | "removed" | "unsupported" | "error">("idle");
  const form = useForm({
    defaultValues: {},
    onSubmit: async () => {
      if (!supportsLocalVerification()) { setStatus("unsupported"); return; }
      setStatus("idle");
      try { await enrollRememberedBrowser(profileId, userRootKey); setStatus("enrolled"); }
      catch { setStatus("error"); }
    }
  });

  async function remove() {
    try { await forgetRememberedBrowser(profileId); setStatus("removed"); }
    catch { setStatus("error"); }
  }

  return <div className="grid gap-3 border-t border-border pt-4">
    <div><h3 className="font-bold text-foreground">Browser yang Diingat</h3><p className="mt-1 text-sm text-muted-foreground">Lindungi salinan kunci lokal dengan Verifikasi Lokal WebAuthn PRF untuk membuka snapshot secara luring.</p></div>
    <form onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
      <form.Subscribe selector={(state) => state.isSubmitting}>{(pending) => <Button type="submit" variant="outline" disabled={pending} aria-busy={pending}><Fingerprint />{pending ? "Memverifikasi…" : "Ingat browser ini"}</Button>}</form.Subscribe>
    </form>
    <Button type="button" variant="ghost" className="justify-self-start text-destructive" onClick={() => void remove()}><Trash2 />Hapus data browser yang diingat</Button>
    {status === "enrolled" && <StatusBanner tone="success">Browser ini dapat memakai Verifikasi Lokal untuk membuka snapshot terenkripsi.</StatusBanner>}
    {status === "removed" && <StatusBanner tone="success">Paket Browser yang Diingat telah dihapus dari perangkat ini.</StatusBanner>}
    {status === "unsupported" && <StatusBanner tone="warning">Browser atau autentikator ini tidak mendukung perlindungan PRF. Gunakan Passphrase Brankas untuk akses luring.</StatusBanner>}
    {status === "error" && <StatusBanner tone="danger" role="alert">Browser tidak dapat diingat. Tidak ada kunci lokal tanpa perlindungan yang disimpan.</StatusBanner>}
  </div>;
}
