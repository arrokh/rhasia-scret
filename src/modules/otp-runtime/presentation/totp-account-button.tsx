"use client";

import { useEffect, useState } from "react";
import { Check, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TotpConfiguration } from "../domain/totp-configuration";
import { generateTotp } from "../application/generate-totp";
import { BrowserHmacGenerator } from "../infrastructure/browser-hmac-generator";

export function TotpAccountButton({ configuration, vaultName, onManage, onAccess }: { configuration: TotpConfiguration; vaultName: string; onManage?: () => void; onAccess?: () => void | Promise<void> }) {
  const [code, setCode] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const [shaking, setShaking] = useState(false);

  useEffect(() => {
    if (status !== "copied") return;
    const timeout = window.setTimeout(() => setStatus("idle"), 2_000);
    return () => window.clearTimeout(timeout);
  }, [status]);

  useEffect(() => {
    let active = true;
    const update = async () => {
      try {
        const next = await generateTotp(configuration, new BrowserHmacGenerator());
        if (!active) return;
        setCode((current) => { if (current && current !== next.value) setStatus("idle"); return next.value; });
        setSeconds(Math.max(0, Math.ceil((next.validUntil.getTime() - Date.now()) / 1_000)));
      } catch { if (active) setStatus("error"); }
    };
    void update();
    const interval = window.setInterval(() => { void update(); }, 1_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [configuration]);

  async function copyOtp() {
    if (!code) return;
    setShaking(true);
    try { void Promise.resolve(onAccess?.()).catch(() => undefined); } catch { /* Audit failure must not block local OTP copy. */ }
    try { await navigator.clipboard.writeText(code); setStatus("copied"); }
    catch { setStatus("error"); }
  }

  const nearlyExpired = seconds > 0 && seconds <= 5;
  return (
    <article
      data-shaking={shaking || undefined}
      className={cn(
        "relative overflow-hidden rounded-lg border bg-card shadow-card transition-colors has-[[data-slot=copy-account]:focus-visible]:ring-3 has-[[data-slot=copy-account]:focus-visible]:ring-ring/40",
        nearlyExpired ? "border-warning/50" : "border-border",
        shaking && "animate-account-shake"
      )}
      onAnimationEnd={() => setShaking(false)}
    >
      <Button
        data-slot="copy-account"
        variant="ghost"
        className="absolute inset-0 z-0 h-full w-full rounded-lg hover:bg-muted/50 active:bg-warning-surface focus-visible:ring-0"
        type="button"
        onClick={() => void copyOtp()}
        disabled={!code}
        aria-label={`Salin OTP untuk ${configuration.accountName}, ${configuration.issuer}`}
      />
      <div className="pointer-events-none relative z-10 grid min-h-32 w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 p-4">
        <span className="grid min-w-0 gap-0.5 self-center">
          <strong className="truncate text-base leading-6 font-bold text-ink-strong">{configuration.issuer}</strong>
          <span className="truncate text-sm text-muted-foreground">{configuration.accountName}</span>
        </span>
        <span className="flex items-center gap-3 self-center">
          <span className="grid gap-0.5 text-right">
            <output className="font-mono text-[2rem] leading-10 font-semibold tracking-[0.02em] text-ink-strong" aria-label="OTP saat ini">{code ? formatOtp(code) : "••• •••"}</output>
            <span className={cn("text-xs font-semibold", status === "error" ? "text-destructive" : status === "copied" ? "text-success" : nearlyExpired ? "text-warning" : "text-muted-foreground")}>
              {status === "copied" ? <span className="inline-flex items-center justify-end gap-1">Disalin <Check className="size-3.5" aria-hidden="true" /></span> : status === "error" ? "Tidak tersedia" : nearlyExpired ? `Berakhir dalam ${seconds} detik` : "Ketuk untuk menyalin"}
            </span>
          </span>
          <Countdown seconds={seconds} period={configuration.period} warning={nearlyExpired} copied={status === "copied"} />
        </span>
        <span className="col-span-2 h-px bg-border/70" aria-hidden="true" />
        <Badge variant="secondary" className="max-w-full self-center truncate bg-muted text-taupe">{vaultName}</Badge>
        {onManage && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="pointer-events-auto relative justify-self-end after:absolute after:-inset-1.5 after:content-['']"
            type="button"
            onClick={onManage}
            aria-label={`Kelola ${configuration.accountName}`}
            title="Kelola akun"
          >
            <MoreVertical />
          </Button>
        )}
        <span className="sr-only" aria-live="polite">{status === "copied" ? `${configuration.accountName} disalin` : status === "error" ? "OTP tidak dapat disalin" : ""}</span>
      </div>
    </article>
  );
}

function Countdown({ seconds, period, warning, copied }: { seconds: number; period: number; warning: boolean; copied: boolean }) {
  return <span className="relative grid size-11 shrink-0 place-items-center" aria-label={`${seconds} detik tersisa`}><svg className="absolute inset-0 size-full -rotate-90" viewBox="0 0 36 36" aria-hidden="true"><circle className="fill-none stroke-border stroke-[3]" cx="18" cy="18" r="15.5" /><circle className={cn("fill-none stroke-primary stroke-[3] transition-[stroke-dashoffset,stroke] duration-200", warning && "stroke-warning", copied && "stroke-success")} cx="18" cy="18" r="15.5" pathLength="100" strokeLinecap="round" strokeDasharray="100" strokeDashoffset={100 - timerProgress(seconds, period)} /></svg><small className={cn("relative text-[0.68rem] font-bold transition-colors duration-200", warning ? "text-warning" : "text-foreground", copied && "text-success")}>{seconds}</small></span>;
}

function timerProgress(seconds: number, period: number): number { return Math.max(0, Math.min(100, (seconds / period) * 100)); }
function formatOtp(code: string): string { const midpoint = Math.ceil(code.length / 2); return `${code.slice(0, midpoint)} ${code.slice(midpoint)}`; }
