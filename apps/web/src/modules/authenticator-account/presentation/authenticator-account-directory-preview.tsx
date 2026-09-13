"use client";

import Link from "next/link";
import { useMemo } from "react";
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
import { SurfaceCard } from "@/shared/presentation/app-ui";
import { AccountDirectoryControls } from "./account-directory-controls";
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
};

export function AuthenticatorAccountDirectoryPreview() {
  const t = useTranslations("Preview.mobile");
  const { preferences, setPreferences } = useAccountDirectoryPreferences("preview-profile");
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
      },
      {
        id: "preview-account-operations",
        vaultId: "preview-operations",
        vaultName: t("operations"),
        issuer: t("workAccount"),
        accountName: "work@local.invalid",
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
  const visibleAccounts = orderedAccounts.filter(
    (account) => activeVaultFilters.length === 0 || activeVaultFilters.includes(account.vaultId),
  );
  const activeVaultFilterLabel =
    activeVaultFilters.length === 0
      ? t("allVaults")
      : activeVaultFilters.length === 1
        ? (vaults.find((vault) => vault.id === activeVaultFilters[0])?.name ?? t("allVaults"))
        : t("selectedVaults", { count: activeVaultFilters.length });

  function moveAccount(sourceKey: string, targetKey: string, placement: "before" | "after" = "before") {
    const keys = orderedAccounts.map(accountDirectoryAccountKey);
    const nextOrder = moveDirectoryAccount(keys, sourceKey, targetKey, placement);
    if (nextOrder !== keys) setPreferences((current) => ({ ...current, order: nextOrder }));
  }

  return (
    <SurfaceCard className="grid min-w-0 gap-5 p-4 sm:p-5" aria-label={t("listLabel")}>
      <div className="flex min-w-0 items-center gap-2" data-slot="vault-account-actions">
        <Button variant="outline" asChild>
          <Link href="/vaults/manage" aria-label={t("vaults")} title={t("vaults")}>
            <Vault aria-hidden="true" />
            <span className="hidden md:inline">{t("vaults")}</span>
          </Link>
        </Button>
        <Button variant="outline" aria-label={t("localAction")} title={t("localAction")}>
          <ArrowLeftRight aria-hidden="true" />
          <span className="hidden md:inline">{t("localAction")}</span>
        </Button>
        <Button variant="outline" aria-label={t("securityAction")} title={t("securityAction")}>
          <ShieldKeyhole aria-hidden="true" />
          <span className="hidden md:inline">{t("securityAction")}</span>
        </Button>
        <AccountDirectoryControls
          vaults={vaults}
          vaultFilters={activeVaultFilters}
          onVaultFiltersChange={(value) => setPreferences((current) => ({ ...current, vaultFilters: value }))}
          view={view}
          onViewChange={(value) => setPreferences((current) => ({ ...current, view: value }))}
          reorderAccounts={orderedAccounts.map((account) => ({
            key: accountDirectoryAccountKey(account),
            issuer: account.issuer,
            accountName: account.accountName,
            vaultName: account.vaultName,
          }))}
          onMoveAccount={moveAccount}
          labels={{
            menuLabel: t("directoryMenu"),
            filterLabel: t("filterByVault"),
            allVaults: t("allVaults"),
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
        <Button asChild className="ml-auto">
          <Link href="/vaults/accounts/new" aria-label={t("addLabel")} title={t("add")}>
            <Plus />
            <span className="hidden md:inline">{t("add")}</span>
          </Link>
        </Button>
      </div>
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs font-bold tracking-wider text-muted-foreground uppercase">{activeVaultFilterLabel}</p>
          <h2 className="mt-1 text-lg font-bold text-ink-strong">{t("accounts")}</h2>
        </div>
        <Badge className="bg-gold-soft text-ink-strong">{visibleAccounts.length}</Badge>
      </div>
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
                    <Badge variant="secondary" className="mt-2 w-fit max-w-full truncate bg-muted text-taupe">
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
      ) : (
        <p className="rounded-lg border border-dashed border-border bg-muted/40 p-8 text-center text-sm text-muted-foreground">
          {t("emptyFiltered")}
        </p>
      )}
    </SurfaceCard>
  );
}
