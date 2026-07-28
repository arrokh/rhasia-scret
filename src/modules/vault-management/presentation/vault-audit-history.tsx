"use client";

import { History, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/shared/presentation/app-ui";
import type { VaultAuditFilter } from "../infrastructure/browser-vault-management-client";
import { useVaultAuditQuery } from "./hooks/use-vault-audit-query";
import type { ManagedVaultAccountSummary } from "./vault-account-management-list";

export type SelectedAuditFilter = { query: VaultAuditFilter; label: string };

export function VaultAuditHistory({ audit, accounts, filter = { query: {}, label: "" }, onClearFilter = () => undefined }: {
  audit: ReturnType<typeof useVaultAuditQuery>;
  accounts: ManagedVaultAccountSummary[];
  filter?: SelectedAuditFilter;
  onClearFilter?: () => void;
}) {
  const events = audit.data?.pages.flatMap((page) => page.events) ?? [];
  const filterNotice = filter.label && <div className="mb-3 flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-sm"><span className="truncate">Filter: <strong>{filter.label}</strong></span><Button variant="ghost" size="icon-xs" type="button" aria-label="Hapus filter audit" onClick={onClearFilter}><X /></Button></div>;
  if (audit.isPending) return <>{filterNotice}<p className="text-sm text-muted-foreground">Memuat riwayat audit…</p></>;
  if (audit.isError && !events.length) return <>{filterNotice}<StatusBanner tone="danger" role="alert">Riwayat audit tidak dapat dimuat.</StatusBanner></>;
  if (!events.length) return <>{filterNotice}<div className="grid justify-items-center gap-2 rounded-md border border-dashed bg-muted/30 p-6 text-center"><History className="size-6 text-taupe" /><p className="font-bold">Belum ada aktivitas</p><p className="text-sm text-muted-foreground">Tidak ada aktivitas yang cocok dengan filter ini.</p></div></>;
  return <>{filterNotice}<div className="grid gap-3"><ul className="grid list-none gap-2 p-0">{events.map((event) => <li key={event.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 rounded-md border bg-card p-3"><p className="min-w-0 text-xs text-muted-foreground"><span className="break-all">{event.actorEmail}</span> · {formatJakartaAuditTime(event.createdAt)}</p><p className="text-right text-sm font-bold text-foreground">{vaultAuditEventLabel(event.eventType)}</p>{event.targetId && <p className="text-xs text-muted-foreground">{accountAuditLabel(accounts, event.targetId)}</p>}<p className="col-start-2 text-right text-xs text-muted-foreground">{relativeAuditTime(event.createdAt)}</p></li>)}</ul>{audit.isError && <StatusBanner tone="danger" role="alert">Aktivitas berikutnya tidak dapat dimuat.</StatusBanner>}{audit.hasNextPage ? <Button variant="outline" type="button" disabled={audit.isFetchingNextPage} onClick={() => void audit.fetchNextPage()}>{audit.isFetchingNextPage ? "Memuat aktivitas…" : "Muat lebih banyak aktivitas"}</Button> : <p className="text-center text-xs text-muted-foreground" aria-live="polite">Semua aktivitas telah dimuat.</p>}</div></>;
}

function accountAuditLabel(accounts: ManagedVaultAccountSummary[], targetId: string): string {
  const account = accounts.find((entry) => entry.id === targetId);
  return account ? `${account.issuer} · ${account.accountName}` : `Akun ${targetId}`;
}

export function vaultAuditEventLabel(eventType: string): string {
  if (eventType === "ACCOUNT_ACCESSED") return "Akun autentikator disalin";
  if (eventType === "ARCHIVE_EXPORTED") return "Arsip Brankas diekspor";
  if (eventType === "ARCHIVE_IMPORTED") return "Arsip Brankas diimpor";
  if (eventType === "VAULT_CREATED") return "Brankas dibuat";
  if (eventType === "ACCOUNT_ADDED") return "Akun ditambahkan";
  if (eventType === "MEMBER_REVOKED") return "Akses anggota dicabut";
  if (eventType === "VAULT_DELETED") return "Brankas dihapus";
  if (eventType === "VAULT_RESTORED") return "Brankas dipulihkan";
  return "Aktivitas keamanan";
}

function formatJakartaAuditTime(value: string): string {
  return new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function relativeAuditTime(value: string): string {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1_000);
  const absoluteSeconds = Math.abs(seconds);
  const formatter = new Intl.RelativeTimeFormat("id-ID", { numeric: "auto" });
  if (absoluteSeconds < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 7) return formatter.format(days, "day");
  const weeks = Math.round(days / 7);
  if (Math.abs(weeks) < 5) return formatter.format(weeks, "week");
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return formatter.format(months, "month");
  return formatter.format(Math.round(days / 365), "year");
}
