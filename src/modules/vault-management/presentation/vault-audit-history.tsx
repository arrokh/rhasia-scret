"use client";

import { useLocale, useTranslations } from "next-intl";
import { History, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatJakartaAuditDateTime, formatRelativeDateTime } from "@/i18n/format";
import { StatusBanner } from "@/shared/presentation/app-ui";
import type { VaultAuditFilter } from "../infrastructure/browser-vault-management-client";
import { useVaultAuditQuery } from "./hooks/use-vault-audit-query";
import type { ManagedVaultAccountSummary } from "./vault-account-management-list";

export type SelectedAuditFilter = { query: VaultAuditFilter; label: string };
type AuditTranslator = ReturnType<typeof useTranslations<"VaultManagement.audit">>;
export type VaultAuditEventMessageKey = "accountAccessed" | "archiveExported" | "archiveImported" | "vaultCreated" | "accountAdded" | "accountUpdated" | "accountDeleted" | "accountRestored" | "memberRevoked" | "memberPermissionsUpdated" | "vaultMemberDefaultsUpdated" | "vaultDeleted" | "vaultRestored" | "securityActivity";

export function VaultAuditHistory({ audit, accounts, filter = { query: {}, label: "" }, onClearFilter = () => undefined }: {
  audit: ReturnType<typeof useVaultAuditQuery>;
  accounts: ManagedVaultAccountSummary[];
  filter?: SelectedAuditFilter;
  onClearFilter?: () => void;
}) {
  const t = useTranslations("VaultManagement.audit");
  const locale = useLocale();
  const events = audit.data?.pages.flatMap((page) => page.events) ?? [];
  const filterNotice = filter.label && <div className="mb-3 flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-sm"><span className="truncate">{t("filter", { label: filter.label })}</span><Button variant="ghost" size="icon-xs" type="button" aria-label={t("clearFilter")} onClick={onClearFilter}><X /></Button></div>;
  if (audit.isPending) return <>{filterNotice}<p className="text-sm text-muted-foreground">{t("loading")}</p></>;
  if (audit.isError && !events.length) return <>{filterNotice}<StatusBanner tone="danger" role="alert">{t("error")}</StatusBanner></>;
  if (!events.length) return <>{filterNotice}<div className="grid justify-items-center gap-2 rounded-md border border-dashed bg-muted/30 p-6 text-center"><History className="size-6 text-taupe" /><p className="font-bold">{t("empty")}</p><p className="text-sm text-muted-foreground">{t("emptyFilter")}</p></div></>;
  return <>{filterNotice}<div className="grid gap-3"><ul className="grid list-none gap-2 p-0">{events.map((event) => <li key={event.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 rounded-md border bg-card p-3"><p className="min-w-0 text-xs text-muted-foreground"><span className="break-all">{event.actorEmail}</span> · {formatJakartaAuditDateTime(event.createdAt, locale)}</p><p className="text-right text-sm font-bold text-foreground">{t(vaultAuditEventMessageKey(event.eventType))}</p>{event.targetId && <p className="text-xs text-muted-foreground">{accountAuditLabel(accounts, event.targetId, t)}</p>}<p className="col-start-2 text-right text-xs text-muted-foreground">{formatRelativeDateTime(event.createdAt, locale)}</p></li>)}</ul>{audit.isError && <StatusBanner tone="danger" role="alert">{t("nextError")}</StatusBanner>}{audit.hasNextPage ? <Button variant="outline" type="button" disabled={audit.isFetchingNextPage} onClick={() => void audit.fetchNextPage()}>{audit.isFetchingNextPage ? t("loadingMore") : t("loadMore")}</Button> : <p className="text-center text-xs text-muted-foreground" aria-live="polite">{t("allLoaded")}</p>}</div></>;
}

function accountAuditLabel(accounts: ManagedVaultAccountSummary[], targetId: string, t: AuditTranslator): string {
  const account = accounts.find((entry) => entry.id === targetId);
  return account && !account.unavailable ? `${account.issuer} · ${account.accountName}` : t("unknownAccount", { id: targetId });
}

export function vaultAuditEventMessageKey(eventType: string): VaultAuditEventMessageKey {
  const keys: Record<string, Exclude<VaultAuditEventMessageKey, "securityActivity">> = {
    ACCOUNT_ACCESSED: "accountAccessed",
    ARCHIVE_EXPORTED: "archiveExported",
    ARCHIVE_IMPORTED: "archiveImported",
    VAULT_CREATED: "vaultCreated",
    ACCOUNT_ADDED: "accountAdded",
    ACCOUNT_UPDATED: "accountUpdated",
    ACCOUNT_DELETED: "accountDeleted",
    ACCOUNT_RESTORED: "accountRestored",
    MEMBER_REVOKED: "memberRevoked",
    MEMBER_PERMISSIONS_UPDATED: "memberPermissionsUpdated",
    VAULT_MEMBER_DEFAULT_PERMISSIONS_UPDATED: "vaultMemberDefaultsUpdated",
    VAULT_DELETED: "vaultDeleted",
    VAULT_RESTORED: "vaultRestored"
  };
  return keys[eventType] ?? "securityActivity";
}
