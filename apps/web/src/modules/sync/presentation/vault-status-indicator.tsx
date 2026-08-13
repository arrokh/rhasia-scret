"use client";

import { useState } from "react";
import { ChevronDown, HardDrive, LoaderCircle, ShieldAlert, Smartphone, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale, useTranslations } from "next-intl";
import { formatLocalDateTime } from "@/i18n/format";
import { cn } from "@/lib/utils";
import { useOnlineStatus } from "@/shared/presentation/use-online-status";
import { resolveVaultStatus, type VaultOrigin } from "../domain/vault-status";
import type { OfflineSyncState } from "@rhasia-scret/client-vault-core";

export function VaultStatusIndicator({ origin, syncState, lastSynchronizedAt, className, collapsible = false }: { origin: VaultOrigin; syncState?: OfflineSyncState; lastSynchronizedAt?: string; className?: string; collapsible?: boolean }) {
  const t = useTranslations("Sync.status");
  const locale = useLocale();
  const onlineHint = useOnlineStatus();
  const status = resolveVaultStatus({ origin, syncState, onlineHint, lastSynchronizedAt });
  const icon = status.kind === "DEVICE_ONLY" ? Smartphone : status.kind === "CURRENT" ? Wifi : status.kind === "OFFLINE_SNAPSHOT" ? WifiOff : status.kind === "RECONNECTING" ? LoaderCircle : status.kind === "AUTH_REQUIRED" || status.kind === "ERROR" || status.kind === "LOCAL_STORAGE_ERROR" ? ShieldAlert : HardDrive;
  const Icon = icon;
  const [expanded, setExpanded] = useState(!collapsible);
  return <div className={cn("grid gap-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs", className)} role="status" aria-live="polite" data-vault-status={status.kind}>
    <div className="flex items-center gap-2 font-bold text-ink-strong">{collapsible ? <Button type="button" variant="ghost" className="h-auto min-w-0 flex-1 justify-start gap-2 p-0 text-left hover:bg-transparent" aria-expanded={expanded} aria-label={expanded ? t("collapse") : t("expand")} onClick={() => setExpanded((value) => !value)}><Icon className={cn("size-4 shrink-0", status.kind === "RECONNECTING" && "animate-spin motion-reduce:animate-none")} aria-hidden="true" /><span className="truncate">{t(status.kind)}</span><ChevronDown className={cn("ml-auto size-4 shrink-0 transition-transform", expanded && "rotate-180")} aria-hidden="true" /></Button> : <><Icon className={cn("size-4", status.kind === "RECONNECTING" && "animate-spin motion-reduce:animate-none")} aria-hidden="true" /><span>{t(status.kind)}</span></>}<span className="ml-auto self-center rounded-full bg-card px-2 py-0.5 font-semibold text-muted-foreground">{t(`origin.${status.origin}`)}</span></div>
    {(!collapsible || expanded) && <><p className="leading-5 text-muted-foreground">{t(`capability.${status.capability}`)}</p>{status.lastSynchronizedAt && status.kind !== "DEVICE_ONLY" && <p className="text-muted-foreground">{t("lastSynchronized", { date: formatLocalDateTime(status.lastSynchronizedAt, locale) })}</p>}{status.kind !== "DEVICE_ONLY" && <p className="text-muted-foreground">{t(onlineHint ? "browserOnlineHint" : "browserOfflineHint")}</p>}</>}
  </div>;
}

export type { VaultStatusKind } from "../domain/vault-status";
