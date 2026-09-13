"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, Check, MoreVertical, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { TotpConfiguration } from "@rhasia-scret/client-vault-core";
import { generateTotp } from "@rhasia-scret/client-vault-core";
import { BrowserHmacGenerator } from "../infrastructure/browser-hmac-generator";
import { browserClipboard } from "@/shared/infrastructure/browser-platform-ports";
import { useTotpClock } from "./use-totp-clock";

export function TotpAccountButton({
  configuration,
  vaultName,
  onManage,
  onAccess,
  density = "normal",
  vaultDetailHref,
  vaultDetailLabel,
}: {
  configuration: TotpConfiguration;
  vaultName: string;
  onManage?: () => void;
  onAccess?: () => void | Promise<void>;
  density?: "compact" | "normal" | "wide";
  vaultDetailHref?: string;
  vaultDetailLabel?: string;
}) {
  const t = useTranslations("OtpRuntime.account");
  const now = useTotpClock();
  const counter = now > 0 ? Math.floor(now / (configuration.period * 1_000)) : null;
  const seconds =
    counter === null ? 0 : Math.max(0, Math.ceil(((counter + 1) * configuration.period * 1_000 - now) / 1_000));
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const [shaking, setShaking] = useState(false);

  useEffect(() => {
    if (status !== "copied") return;
    const timeout = window.setTimeout(() => setStatus("idle"), 2_000);
    return () => window.clearTimeout(timeout);
  }, [status]);

  useEffect(() => {
    if (counter === null) return;
    let active = true;
    generateTotp(configuration, new BrowserHmacGenerator(), new Date(counter * configuration.period * 1_000))
      .then((next) => {
        if (!active) return;
        setCode((current) => {
          if (current && current !== next.value) setStatus("idle");
          return next.value;
        });
      })
      .catch(() => {
        if (active) setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [configuration, counter]);

  async function copyOtp() {
    if (!code) return;
    setShaking(true);
    try {
      void Promise.resolve(onAccess?.()).catch(() => undefined);
    } catch {
      /* Audit failure must not block local OTP copy. */
    }
    try {
      await browserClipboard.writeText(code);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  }

  const nearlyExpired = seconds > 0 && seconds <= 5;
  return (
    <article
      data-shaking={shaking || undefined}
      className={cn(
        "relative overflow-hidden rounded-lg border bg-card shadow-card transition-colors has-[[data-slot=copy-account]:focus-visible]:ring-3 has-[[data-slot=copy-account]:focus-visible]:ring-ring/40",
        nearlyExpired ? "border-warning/50" : "border-border",
        shaking && "animate-account-shake",
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
        aria-label={t("copyLabel", { account: configuration.accountName, issuer: configuration.issuer })}
      />
      <div
        className={cn(
          "pointer-events-none relative z-10 grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 transition-[padding,min-height] duration-300 ease-out",
          density === "compact" && "min-h-24 p-3",
          density === "normal" && "min-h-32 p-4",
          density === "wide" && "min-h-36 p-5",
        )}
      >
        <span className="grid min-w-0 gap-0.5 self-center">
          <strong className="truncate text-base leading-6 font-bold text-ink-strong">{configuration.issuer}</strong>
          <span className="truncate text-sm text-muted-foreground">{configuration.accountName}</span>
        </span>
        <span className="flex items-center gap-3 self-center">
          <span className="grid gap-0.5 text-right">
            <output
              className={cn(
                "font-mono leading-10 font-semibold tracking-[0.02em] text-ink-strong transition-[font-size] duration-300",
                density === "compact" && "text-[1.75rem]",
                density === "normal" && "text-[2rem]",
                density === "wide" && "text-[2.25rem]",
              )}
              aria-label={t("current")}
            >
              {code ? formatOtp(code) : "••• •••"}
            </output>
            <span
              className={cn(
                "text-xs font-semibold",
                status === "error"
                  ? "text-destructive"
                  : status === "copied"
                    ? "text-success"
                    : nearlyExpired
                      ? "text-warning"
                      : "text-muted-foreground",
              )}
            >
              {status === "copied" ? (
                <span className="inline-flex items-center justify-end gap-1">
                  {t("copied")} <Check className="size-3.5" aria-hidden="true" />
                </span>
              ) : status === "error" ? (
                t("unavailable")
              ) : nearlyExpired ? (
                t("expires", { seconds })
              ) : (
                t("tap")
              )}
            </span>
          </span>
          <Countdown
            seconds={seconds}
            period={configuration.period}
            warning={nearlyExpired}
            copied={status === "copied"}
            label={t("remaining", { seconds })}
          />
        </span>
        <span className="col-span-2 h-px bg-border/70" aria-hidden="true" />
        <div className="pointer-events-auto col-span-2 flex min-w-0 items-center gap-1">
          <Badge variant="secondary" className="mr-auto max-w-full truncate bg-muted text-taupe">
            {vaultName}
          </Badge>
          {(onManage || (vaultDetailHref && vaultDetailLabel)) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  aria-label={t("manage", { account: configuration.accountName })}
                  title={t("manageTitle")}
                >
                  <MoreVertical aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 rounded-md border-border bg-popover p-2 shadow-card">
                {vaultDetailHref && vaultDetailLabel && (
                  <DropdownMenuItem asChild>
                    <Link href={vaultDetailHref} aria-label={vaultDetailLabel}>
                      <ArrowUpRight aria-hidden="true" />
                      {t("openVault")}
                    </Link>
                  </DropdownMenuItem>
                )}
                {onManage && vaultDetailHref && vaultDetailLabel && <DropdownMenuSeparator />}
                {onManage && (
                  <DropdownMenuItem onSelect={onManage}>
                    <Pencil aria-hidden="true" />
                    {t("manageTitle")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <span className="sr-only" aria-live="polite">
          {status === "copied"
            ? t("copiedAnnouncement", { account: configuration.accountName })
            : status === "error"
              ? t("copyError")
              : ""}
        </span>
      </div>
    </article>
  );
}

function Countdown({
  seconds,
  period,
  warning,
  copied,
  label,
}: {
  seconds: number;
  period: number;
  warning: boolean;
  copied: boolean;
  label: string;
}) {
  return (
    <span className="relative grid size-11 shrink-0 place-items-center" aria-label={label}>
      <svg className="absolute inset-0 size-full -rotate-90" viewBox="0 0 36 36" aria-hidden="true">
        <circle className="fill-none stroke-border stroke-[3]" cx="18" cy="18" r="15.5" />
        <circle
          className={cn(
            "fill-none stroke-primary stroke-[3] transition-[stroke-dashoffset,stroke] duration-200",
            warning && "stroke-warning",
            copied && "stroke-success",
          )}
          cx="18"
          cy="18"
          r="15.5"
          pathLength="100"
          strokeLinecap="round"
          strokeDasharray="100"
          strokeDashoffset={100 - timerProgress(seconds, period)}
        />
      </svg>
      <small
        className={cn(
          "relative text-[0.68rem] font-bold transition-colors duration-200",
          warning ? "text-warning" : "text-foreground",
          copied && "text-success",
        )}
      >
        {seconds}
      </small>
    </span>
  );
}

function timerProgress(seconds: number, period: number): number {
  return Math.max(0, Math.min(100, (seconds / period) * 100));
}
function formatOtp(code: string): string {
  const midpoint = Math.ceil(code.length / 2);
  return `${code.slice(0, midpoint)} ${code.slice(midpoint)}`;
}
