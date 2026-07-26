"use client";

import { useState, useSyncExternalStore } from "react";
import { KeyRound, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { redeemSecureShareLink } from "../infrastructure/browser-secure-share-link-workflow";

export function SecureShareLinkRedemption({ userRootKey }: { userRootKey: Uint8Array }) {
  const secret = useSyncExternalStore(subscribeToHash, readHash, () => "");
  const [status, setStatus] = useState<"idle" | "redeeming" | "error">("idle");
  async function redeem() {
    if (!secret) { setStatus("error"); return; }
    setStatus("redeeming");
    try { await redeemSecureShareLink(secret, userRootKey); window.location.assign("/vaults"); }
    catch { setStatus("error"); }
  }
  return <div className="grid gap-5 p-5 sm:p-6">
    <div className="grid justify-items-center gap-3 text-center"><span className="grid size-14 place-items-center rounded-xl bg-gold-soft text-ink-strong"><KeyRound /></span><div><h2 className="font-bold text-ink-strong">Terima undangan Brankas Bersama</h2><p className="mt-1 text-sm leading-5 text-muted-foreground">Kunci brankas dibuka dan dibungkus ulang hanya di browser ini.</p></div></div>
    {!secret && <StatusBanner tone="danger" role="alert">Tautan undangan tidak lengkap.</StatusBanner>}
    <Button type="button" onClick={() => void redeem()} disabled={!secret || status === "redeeming"} aria-busy={status === "redeeming"}>{status === "redeeming" && <LoaderCircle className="animate-spin" />}{status === "redeeming" ? "Menerima undangan…" : "Terima undangan"}</Button>
    {status === "error" && secret && <StatusBanner tone="danger" role="alert">Undangan tidak dapat digunakan. Tautan mungkin sudah pernah digunakan atau bukan untuk akun ini.</StatusBanner>}
  </div>;
}

function subscribeToHash(onChange: () => void) { window.addEventListener("hashchange", onChange); return () => window.removeEventListener("hashchange", onChange); }
function readHash() { return window.location.hash.slice(1); }
