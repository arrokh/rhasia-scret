"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeftRight, ArrowUpRight, MoreVertical, Plus, ShieldKeyhole, Vault } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  matchesAuthenticatorAccountSearch,
  matchesAuthenticatorAccountTagFilter,
} from "@rhasia-scret/client-vault-core";
import { SurfaceCard, SURFACE_CARD_CONTENT_PADDING_CLASS } from "@/shared/presentation/app-ui";
import { AccountDirectoryControls } from "./account-directory-controls";
import { AccountDirectorySearch, AccountSearchEmptyState } from "./account-directory-search";
import {
  accountDirectoryAccountKey,
  moveDirectoryAccount,
  orderDirectoryAccounts,
  useAccountDirectoryPreferences,
} from "./account-directory-preferences";

type PreviewAccount = {
  id: string;
  vaultId: string;
  vaultName: string;
  issuer: string;
  accountName: string;
  tags: string[];
};

export function AuthenticatorAccountDirectoryPreview() {
  const t = useTranslations("Preview.authenticatorAccounts");
  const searchInputId = "preview-account-directory-search";
  const searchPanelId = `${searchInputId}-panel`;
  const { preferences, setPreferences } = useAccountDirectoryPreferences("preview-profile");
  const [issuerFilters, setIssuerFilters] = useState<string[]>([]);
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const { view, vaultFilters, order } = preferences;
  const vaults = useMemo(
    () => [
      { id: "preview-personal", name: t("personalVault") },
      { id: "preview-operations", name: t("operations") },
    ],
    [t],
  );
  const accounts = useMemo<PreviewAccount[]>(
    () => [
      {
        id: "preview-account-personal",
        vaultId: "preview-personal",
        vaultName: t("personalVault"),
        issuer: t("sampleService"),
        accountName: "example@local.invalid",
        tags: ["Work"],
      },
      {
        id: "preview-account-operations",
        vaultId: "preview-operations",
        vaultName: t("operations"),
        issuer: t("workAccount"),
        accountName: "work@local.invalid",
        tags: ["Recovery"],
      },
    ],
    [t],
  );
  const orderedAccounts = useMemo(() => orderDirectoryAccounts(accounts, order), [accounts, order]);
  const activeVaultFilters = useMemo(() => {
    const availableVaultIds = new Set(vaults.map((vault) => vault.id));
    return vaultFilters.filter(
      (vaultId, index, filters) => availableVaultIds.has(vaultId) && filters.indexOf(vaultId) === index,
    );
  }, [vaultFilters, vaults]);
  const activeIssuerFilters = useMemo(() => {
    const availableIssuers = new Set(orderedAccounts.map((account) => account.issuer));
    return issuerFilters.filter(
      (issuer, index, filters) => availableIssuers.has(issuer) && filters.indexOf(issuer) === index,
    );
  }, [issuerFilters, orderedAccounts]);
  const tagOptions = useMemo(() => [...new Set(orderedAccounts.flatMap((account) => account.tags))], [orderedAccounts]);
  const activeTagFilters = useMemo(
    () => tagFilters.filter((tag, index, filters) => tagOptions.includes(tag) && filters.indexOf(tag) === index),
    [tagFilters, tagOptions],
  );
  const visibleAccounts = useMemo(
    () =>
      orderedAccounts.filter(
        (account) =>
          (activeVaultFilters.length === 0 || activeVaultFilters.includes(account.vaultId)) &&
          (activeIssuerFilters.length === 0 || activeIssuerFilters.includes(account.issuer)) &&
          matchesAuthenticatorAccountTagFilter(account.tags, activeTagFilters) &&
          matchesAuthenticatorAccountSearch(account, searchQuery),
      ),
    [activeIssuerFilters, activeTagFilters, activeVaultFilters, orderedAccounts, searchQuery],
  );
  const activeFilterLabel = useMemo(() => {
    const vaultLabel =
      activeVaultFilters.length === 0
        ? t("allVaults")
        : activeVaultFilters.length === 1
          ? (vaults.find((vault) => vault.id === activeVaultFilters[0])?.name ?? t("allVaults"))
          : t("selectedVaults", { count: activeVaultFilters.length });
    const labels = [vaultLabel];
    if (activeIssuerFilters.length > 0) {
      labels.push(
        activeIssuerFilters.length === 1
          ? (activeIssuerFilters[0] ?? "")
          : t("selectedIssuers", { count: activeIssuerFilters.length }),
      );
    }
    if (activeTagFilters.length > 0) labels.push(t("selectedTags", { count: activeTagFilters.length }));
    return labels.join(" · ");
  }, [activeIssuerFilters, activeTagFilters, activeVaultFilters, t, vaults]);
  const hasActiveFilters =
    activeVaultFilters.length > 0 || activeIssuerFilters.length > 0 || activeTagFilters.length > 0;

  function moveAccount(sourceKey: string, targetKey: string, placement: "before" | "after" = "before") {
    const keys = orderedAccounts.map(accountDirectoryAccountKey);
    const nextOrder = moveDirectoryAccount(keys, sourceKey, targetKey, placement);
    if (nextOrder !== keys) setPreferences((current) => ({ ...current, order: nextOrder }));
  }

  return (
    <SurfaceCard className={cn("grid min-w-0 gap-5", SURFACE_CARD_CONTENT_PADDING_CLASS)} aria-label={t("listLabel")}>
      <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4" data-slot="vault-account-actions">
        <Button
          variant="outline"
          asChild
          className="h-12 min-h-12 w-full min-w-0 flex-col gap-0.5 px-1 text-center text-xs leading-3 whitespace-normal lg:flex-row lg:gap-1 lg:leading-normal"
        >
          <Link href="/vaults/manage" aria-label={t("vaults")} title={t("vaults")}>
            <Vault className="size-4 md:size-5" aria-hidden="true" />
            <span className="min-w-0 whitespace-normal leading-3 md:leading-normal">{t("vaults")}</span>
          </Link>
        </Button>
        <Button
          variant="outline"
          className="h-12 min-h-12 w-full min-w-0 flex-col gap-0.5 px-1 text-center text-xs leading-3 whitespace-normal lg:flex-row lg:gap-1 lg:leading-normal"
          aria-label={t("localAction")}
          title={t("localAction")}
        >
          <ArrowLeftRight className="size-4 md:size-5" aria-hidden="true" />
          <span className="min-w-0 whitespace-normal leading-3 md:leading-normal">{t("localAction")}</span>
        </Button>
        <Button
          variant="outline"
          className="h-12 min-h-12 w-full min-w-0 flex-col gap-0.5 px-1 text-center text-xs leading-3 whitespace-normal lg:flex-row lg:gap-1 lg:leading-normal"
          aria-label={t("securityAction")}
          title={t("securityAction")}
        >
          <ShieldKeyhole className="size-4 md:size-5" aria-hidden="true" />
          <span className="min-w-0 whitespace-normal leading-3 md:leading-normal">{t("securityAction")}</span>
        </Button>
        <Button
          asChild
          className="h-12 min-h-12 w-full min-w-0 flex-col gap-0.5 px-1 text-center text-xs leading-3 whitespace-normal lg:flex-row lg:gap-1 lg:leading-normal"
        >
          <Link href="/vaults/accounts/new" aria-label={t("addLabel")} title={t("add")}>
            <Plus className="size-4 md:size-5" aria-hidden="true" />
            <span className="min-w-0 whitespace-normal leading-3 md:leading-normal">{t("add")}</span>
          </Link>
        </Button>
      </div>
      <div className="flex min-w-0 items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="max-w-full truncate text-xs font-bold tracking-wider text-muted-foreground uppercase">
            {activeFilterLabel}
          </p>
          <h2 className="mt-1 text-lg font-bold text-ink-strong">{t("accounts")}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Badge className="bg-gold-soft text-ink-strong">{visibleAccounts.length}</Badge>
          <AccountDirectoryControls
            vaults={vaults}
            vaultFilters={activeVaultFilters}
            onVaultFiltersChange={(value) => setPreferences((current) => ({ ...current, vaultFilters: value }))}
            issuerFilters={activeIssuerFilters}
            onIssuerFiltersChange={setIssuerFilters}
            tagOptions={tagOptions}
            tagFilters={activeTagFilters}
            onTagFiltersChange={setTagFilters}
            view={view}
            onViewChange={(value) => setPreferences((current) => ({ ...current, view: value }))}
            directoryActionsEnabled={true}
            searchOpen={searchOpen}
            searchActive={searchQuery.trim().length > 0}
            searchPanelId={searchPanelId}
            onSearchOpenChange={setSearchOpen}
            reorderAccounts={orderedAccounts.map((account) => ({
              key: accountDirectoryAccountKey(account),
              issuer: account.issuer,
              accountName: account.accountName,
              vaultName: account.vaultName,
            }))}
            onMoveAccount={moveAccount}
            labels={{
              menuLabel: t("directoryMenu"),
              filterLabel: t("filterLabel"),
              filterByVault: t("filterByVault"),
              filterByIssuer: t("filterByIssuer"),
              filterByTag: t("filterByTag"),
              filtersApplied: t("filtersApplied"),
              clearFilters: t("clearFilters"),
              showSearch: t("showSearch"),
              hideSearch: t("hideSearch"),
              searchApplied: t("searchApplied"),
              allVaults: t("allVaults"),
              allIssuers: t("allIssuers"),
              allTags: t("allTags"),
              viewLabel: t("viewLabel"),
              compact: t("compact"),
              normal: t("normal"),
              wide: t("wide"),
              reorder: t("reorderAccounts"),
              reorderTitle: t("reorderAccountsTitle"),
              reorderDescription: t("reorderAccountsDescription"),
              close: t("close"),
              dragAccount: (account) => t("dragAccount", { account }),
              moveUp: (account) => t("moveUp", { account }),
              moveDown: (account) => t("moveDown", { account }),
            }}
          />
        </div>
      </div>
      {searchOpen && (
        <AccountDirectorySearch
          query={searchQuery}
          inputId={searchInputId}
          panelId={searchPanelId}
          autoFocus
          onQueryChange={setSearchQuery}
        />
      )}
      {visibleAccounts.length ? (
        <ul
          data-slot="account-directory-list"
          data-view-mode={view}
          className={cn(
            "grid list-none p-0 transition-[gap,grid-template-columns] duration-300 ease-out",
            view === "compact" && "grid-cols-1 gap-2 sm:grid-cols-2",
            view === "normal" && "grid-cols-1 gap-3",
            view === "wide" && "grid-cols-1 gap-4",
          )}
        >
          {visibleAccounts.map((account) => {
            const accountKey = accountDirectoryAccountKey(account);
            return (
              <li key={accountKey} data-account-key={accountKey} className="min-w-0 rounded-lg">
                <article className="grid min-h-24 grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-card transition-[padding,min-height] duration-300 sm:p-4">
                  <span className="grid size-10 place-items-center rounded-md bg-muted font-bold text-foreground">
                    {account.issuer[0]}
                  </span>
                  <span className="grid min-w-0">
                    <strong className="truncate text-sm text-ink-strong">{account.issuer}</strong>
                    <span className="truncate text-sm text-muted-foreground">{account.accountName}</span>
                    <ul aria-label={t("tags")} className="mt-1 flex list-none flex-wrap gap-1 p-0">
                      {account.tags.map((tag) => (
                        <li key={tag}>
                          <Badge variant="outline" className="bg-card text-muted-foreground">
                            {tag}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                    <Badge
                      variant="secondary"
                      className="mt-2 w-fit max-w-full truncate bg-muted text-muted-foreground"
                    >
                      {account.vaultName}
                    </Badge>
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        type="button"
                        aria-label={t("accountActions", { account: account.accountName })}
                        title={t("accountActions", { account: account.accountName })}
                      >
                        <MoreVertical aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="w-56 rounded-md border-border bg-popover p-2 shadow-card"
                    >
                      <DropdownMenuItem asChild>
                        <Link href="/ui-preview/vaults" aria-label={t("openVault", { vault: account.vaultName })}>
                          <ArrowUpRight aria-hidden="true" />
                          {t("openVault", { vault: account.vaultName })}
                        </Link>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </article>
              </li>
            );
          })}
        </ul>
      ) : searchQuery.trim().length > 0 ? (
        <AccountSearchEmptyState
          onClearSearch={() => setSearchQuery("")}
          onClearFilters={
            hasActiveFilters
              ? () => {
                  setSearchQuery("");
                  setIssuerFilters([]);
                  setTagFilters([]);
                  setPreferences((current) => ({ ...current, vaultFilters: [] }));
                }
              : undefined
          }
        />
      ) : (
        <div className="grid justify-items-center gap-3 rounded-lg border border-dashed border-border bg-muted/40 p-8 text-center">
          <p className="text-sm text-muted-foreground">{hasActiveFilters ? t("emptyFiltered") : t("empty")}</p>
          {hasActiveFilters && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSearchQuery("");
                setIssuerFilters([]);
                setTagFilters([]);
                setPreferences((current) => ({ ...current, vaultFilters: [] }));
              }}
            >
              {t("clearFilters")}
            </Button>
          )}
        </div>
      )}
    </SurfaceCard>
  );
}
