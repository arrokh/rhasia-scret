"use client";

import { useEffect, useState } from "react";
import { Check, LockKeyhole, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";

type VaultPreview = { vault: string; account: string; detail: string; access: string; copyValue: string; copiedLabel: string };

export function LandingVaultPreviews({ entries }: { entries: VaultPreview[] }) {
  const [seconds, setSeconds] = useState(30);
  const [cycle, setCycle] = useState(0);
  const [copiedVault, setCopiedVault] = useState<string | null>(null);
  const [shakingVault, setShakingVault] = useState<string | null>(null);
  useEffect(() => {
    const interval = window.setInterval(() => setSeconds((current) => {
      if (current > 1) return current - 1;
      setCycle((value) => value + 1);
      return 30;
    }), 1_000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => {
    if (!copiedVault) return;
    const timeout = window.setTimeout(() => setCopiedVault(null), 2_000);
    return () => window.clearTimeout(timeout);
  }, [copiedVault]);
  async function copyPreview(entry: VaultPreview) {
    setShakingVault(entry.vault);
    try {
      await navigator.clipboard.writeText(entry.copyValue);
      setCopiedVault(entry.vault);
    } catch {
      setCopiedVault(null);
    }
  }
  return <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">{entries.map((entry, index) => {
    const code = String((((cycle + 1) * (index + 3) * 7_919) % 1_000_000)).padStart(6, "0");
    const shared = index === entries.length - 1;
    const copied = copiedVault === entry.vault;
    return <article key={entry.vault} className={`relative overflow-hidden rounded-lg border border-border bg-card shadow-card transition-colors has-[[data-slot=copy-preview]:focus-visible]:ring-3 has-[[data-slot=copy-preview]:focus-visible]:ring-ring/40 ${shakingVault === entry.vault ? "animate-account-shake" : ""}`} onAnimationEnd={() => setShakingVault(null)}><Button data-slot="copy-preview" variant="ghost" type="button" className="grid h-auto w-full justify-stretch gap-1 rounded-lg px-4 py-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/40 active:bg-warning-surface sm:p-3" onClick={() => void copyPreview(entry)} aria-label={entry.copyValue}><div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2"><span className="grid min-w-0 gap-0.5"><strong className="truncate text-[0.65rem] leading-4 font-bold text-ink-strong sm:text-xs">{entry.account}</strong><span className="truncate text-[0.6rem] text-muted-foreground sm:text-[0.7rem]">{entry.detail}</span></span><span className="grid justify-items-end gap-1"><output className="font-mono text-xs font-semibold tracking-wide text-ink-strong sm:text-sm" aria-label={entry.detail}>{code.slice(0, 3)} {code.slice(3)}</output><Countdown seconds={seconds} /></span></div><span className="h-px bg-border/70" aria-hidden="true" /><span className="flex min-w-0 items-center gap-1"><span className="truncate rounded-full bg-muted px-1.5 py-0.5 text-[0.55rem] font-bold text-taupe sm:text-[0.65rem]">{entry.vault}</span><span className="flex min-w-0 items-center gap-1 truncate text-[0.55rem] text-muted-foreground sm:text-[0.65rem]">{shared ? <UsersRound className="size-3 shrink-0 text-primary" aria-hidden="true" /> : <LockKeyhole className="size-3 shrink-0 text-primary" aria-hidden="true" />}{entry.access}</span></span></Button>{copied && <span className="landing-copy-toast"><Check className="size-3" aria-hidden="true" />{entry.copiedLabel}</span>}<span className="sr-only" aria-live="polite">{copied ? entry.copiedLabel : ""}</span></article>;
  })}</div>;
}

function Countdown({ seconds }: { seconds: number }) {
  return <span className="relative grid size-5 place-items-center" aria-hidden="true"><svg className="absolute inset-0 size-full -rotate-90" viewBox="0 0 36 36"><circle className="fill-none stroke-border stroke-[3]" cx="18" cy="18" r="15.5" /><circle className="fill-none stroke-primary stroke-[3] transition-[stroke-dashoffset] duration-300" cx="18" cy="18" r="15.5" pathLength="100" strokeLinecap="round" strokeDasharray="100" strokeDashoffset={100 - ((seconds / 30) * 100)} /></svg><small className="relative text-[0.5rem] font-bold text-primary">{seconds}</small></span>;
}
