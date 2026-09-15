"use client";

import Link from "next/link";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeftRight, KeyRound, Plus, ShieldKeyhole, Vault } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { PasskeyRecoveryEnrollment, RememberedBrowserEnrollment } from "@/modules/crypto";
import { TotpAccountButton } from "@/modules/otp-runtime";
import { VaultStatusIndicator, type WorkspaceAuthenticatorAccount } from "@/modules/sync";
import { recordSharedVaultAccountAccess } from "@/modules/audit";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { cn } from "@/lib/utils";
import { LocalVaultCopyPanel } from "@/modules/local-vault";
import { AccountDirectoryControls } from "./account-directory-controls";
import {
  accountDirectoryAccountKey,
  moveDirectoryAccount,
  orderDirectoryAccounts,
  useAccountDirectoryPreferences,
} from "./account-directory-preferences";
import { AuthenticatorAccountManagerDialog } from "./authenticator-account-manager-dialog";
import { useUnlockedVaultWorkspace } from "./unlocked-vault-workspace-provider";
import { VaultWorkspaceUnlock } from "./vault-workspace-unlock";

export function PersonalVaultAccounts({ vaultId }: { vaultId: string }) {
  const t = useTranslations("AuthenticatorAccount.accounts");
  const { workspace, setWorkspace, refreshWorkspaceAuthorization } = useUnlockedVaultWorkspace();
  const [managedAccount, setManagedAccount] = useState<WorkspaceAuthenticatorAccount | null>(null);
  const [auditError, setAuditError] = useState(false);
  const [lastMovedKey, setLastMovedKey] = useState<string | null>(null);
  const [issuerFilters, setIssuerFilters] = useState<string[]>([]);
  const [reorderVersion, setReorderVersion] = useState(0);
  const accountListRef = useRef<HTMLUListElement>(null);
  const previousAccountRectsRef = useRef(new Map<string, DOMRect>());
  const animationFrameRef = useRef<number | null>(null);
  const { preferences, setPreferences } = useAccountDirectoryPreferences(workspace?.profileId ?? null);
  const orderedAccounts = useMemo(
    () => orderDirectoryAccounts(workspace?.accounts ?? [], preferences.order),
    [preferences.order, workspace?.accounts],
  );
  const vaultOptions = useMemo(
    () => (workspace?.vaults ?? []).map((vault) => ({ id: vault.id, name: vault.name })),
    [workspace?.vaults],
  );
  const activeVaultFilters = useMemo(() => {
    const availableVaultIds = new Set(vaultOptions.map((vault) => vault.id));
    return preferences.vaultFilters.filter(
      (vaultId, index, filters) => availableVaultIds.has(vaultId) && filters.indexOf(vaultId) === index,
    );
  }, [preferences.vaultFilters, vaultOptions]);
  const activeIssuerFilters = useMemo(() => {
    const availableIssuers = new Set(orderedAccounts.map((account) => account.issuer));
    return issuerFilters.filter(
      (issuer, index, filters) => availableIssuers.has(issuer) && filters.indexOf(issuer) === index,
    );
  }, [issuerFilters, orderedAccounts]);
  const visibleAccounts = useMemo(
    () =>
      orderedAccounts.filter(
        (account) =>
          (activeVaultFilters.length === 0 || activeVaultFilters.includes(account.vaultId)) &&
          (activeIssuerFilters.length === 0 || activeIssuerFilters.includes(account.issuer)),
      ),
    [activeIssuerFilters, activeVaultFilters, orderedAccounts],
  );
  const activeFilterLabel = useMemo(() => {
    const vaultLabel =
      activeVaultFilters.length === 0
        ? t("allVaults")
        : activeVaultFilters.length === 1
          ? (vaultOptions.find((vault) => vault.id === activeVaultFilters[0])?.name ?? t("allVaults"))
          : t("selectedVaults", { count: activeVaultFilters.length });
    if (activeIssuerFilters.length === 0) return vaultLabel;
    const issuerLabel =
      activeIssuerFilters.length === 1
        ? activeIssuerFilters[0]
        : t("selectedIssuers", { count: activeIssuerFilters.length });
    return `${vaultLabel} · ${issuerLabel}`;
  }, [activeIssuerFilters, activeVaultFilters, t, vaultOptions]);
  const hasActiveFilters = activeVaultFilters.length > 0 || activeIssuerFilters.length > 0;

  useLayoutEffect(() => {
    const list = accountListRef.current;
    if (!list) return;
    const items = Array.from(list.querySelectorAll<HTMLElement>("[data-account-key]"));
    const nextRects = new Map(items.map((item) => [item.dataset.accountKey ?? "", item.getBoundingClientRect()]));

    if (reorderVersion === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      previousAccountRectsRef.current = nextRects;
      return;
    }

    animationFrameRef.current = requestAnimationFrame(() => {
      for (const item of items) {
        const key = item.dataset.accountKey;
        if (!key) continue;
        const previous = previousAccountRectsRef.current.get(key);
        const current = nextRects.get(key);
        if (!previous || !current) continue;
        const deltaX = previous.left - current.left;
        const deltaY = previous.top - current.top;
        if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) continue;
        item.style.transition = "none";
        item.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
        item.style.willChange = "transform";
        requestAnimationFrame(() => {
          item.style.transition = "transform 280ms cubic-bezier(0.22, 1, 0.36, 1)";
          item.style.transform = "";
          item.style.willChange = "";
        });
      }
    });
    previousAccountRectsRef.current = nextRects;

    return () => {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    };
  }, [activeVaultFilters, orderedAccounts, preferences.view, reorderVersion]);

  const moveAccount = useCallback(
    (sourceKey: string, targetKey: string, placement: "before" | "after" = "before") => {
      if (sourceKey === targetKey) return;
      const fullOrder = orderedAccounts.map(accountDirectoryAccountKey);
      const nextOrder = moveDirectoryAccount(fullOrder, sourceKey, targetKey, placement);
      if (nextOrder === fullOrder) return;
      setPreferences((current) => ({ ...current, order: nextOrder }));
      setReorderVersion((current) => current + 1);
      setLastMovedKey(sourceKey);
    },
    [orderedAccounts, setPreferences],
  );

  if (!workspace) return <VaultWorkspaceUnlock personalVaultId={vaultId} onUnlocked={setWorkspace} />;
  const current = workspace.syncState === "CURRENT";
  const personalVault = workspace.vaults.find((vault) => vault.id === vaultId && vault.type === "PERSONAL");
  const personalAccounts = workspace.accounts.filter(
    (account) => account.vaultId === vaultId && account.vaultType === "PERSONAL",
  );
  const lastMovedAccount = orderedAccounts.find((account) => accountDirectoryAccountKey(account) === lastMovedKey);
  const lastMovedPosition =
    visibleAccounts.findIndex((account) => accountDirectoryAccountKey(account) === lastMovedKey) + 1;

  return (
    <section className="grid min-w-0 gap-5 p-4 sm:p-5" aria-labelledby="account-list-heading">
      <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4" data-slot="vault-account-actions">
        {current && (
          <Button
            variant="outline"
            asChild
            className="h-auto min-h-12 w-full min-w-0 py-2 text-center whitespace-normal"
          >
            <Link href="/vaults/manage" prefetch={true} aria-label={t("vaults")} title={t("vaults")}>
              <Vault aria-hidden="true" />
              <span className="hidden min-w-0 whitespace-normal md:inline">{t("vaults")}</span>
            </Link>
          </Button>
        )}
        {current && personalVault && (
          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                className="h-auto min-h-12 w-full min-w-0 py-2 text-center whitespace-normal"
                aria-label={t("localAction")}
                title={t("localAction")}
              >
                <ArrowLeftRight aria-hidden="true" />
                <span className="hidden min-w-0 whitespace-normal md:inline">{t("localAction")}</span>
              </Button>
            </SheetTrigger>
            <SheetContent
              side="bottom"
              className="max-h-[85dvh] gap-5 overflow-y-auto rounded-t-xl border-border bg-card px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-sheet sm:mx-auto sm:max-w-lg"
            >
              <SheetHeader className="p-0 pt-5">
                <SheetTitle>{t("localTitle")}</SheetTitle>
                <SheetDescription>{t("localDescription")}</SheetDescription>
              </SheetHeader>
              <LocalVaultCopyPanel
                personalVaultId={personalVault.id}
                personalVaultName={personalVault.name}
                personalVaultKey={personalVault.key}
                personalAccounts={personalAccounts}
                onPersonalAccountsCopied={(accounts) =>
                  setWorkspace((value) => (value ? { ...value, accounts: [...value.accounts, ...accounts] } : value))
                }
              />
            </SheetContent>
          </Sheet>
        )}
        {current && (
          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                className="h-auto min-h-12 w-full min-w-0 py-2 text-center whitespace-normal"
                aria-label={t("securityAction")}
                title={t("securityAction")}
              >
                <ShieldKeyhole aria-hidden="true" />
                <span className="hidden min-w-0 whitespace-normal md:inline">{t("securityAction")}</span>
              </Button>
            </SheetTrigger>
            <SheetContent
              side="bottom"
              className="gap-5 rounded-t-xl border-border bg-card px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-sheet sm:mx-auto sm:max-w-lg"
            >
              <SheetHeader className="p-0 pt-5">
                <SheetTitle>{t("security")}</SheetTitle>
                <SheetDescription>{t("securityDescription")}</SheetDescription>
              </SheetHeader>
              <div className="grid gap-4">
                <PasskeyRecoveryEnrollment userRootKey={workspace.userRootKey} />
                <RememberedBrowserEnrollment profileId={workspace.profileId} userRootKey={workspace.userRootKey} />
              </div>
            </SheetContent>
          </Sheet>
        )}
        {current && (
          <Button asChild className="h-auto min-h-12 w-full min-w-0 py-2 text-center whitespace-normal">
            <Link href="/vaults/accounts/new" aria-label={t("addAccountLabel")} title={t("addAccount")}>
              <Plus />
              <span className="hidden min-w-0 whitespace-normal md:inline">{t("addAccount")}</span>
            </Link>
          </Button>
        )}
      </div>
      <VaultStatusIndicator
        origin="PERSONAL"
        syncState={workspace.syncState}
        lastSynchronizedAt={workspace.synchronizedAt}
        collapsible
      />
      {workspace.unavailableSharedVaults > 0 && (
        <StatusBanner tone="danger" role="alert">
          {t("unavailableVaults", { count: workspace.unavailableSharedVaults })}
        </StatusBanner>
      )}
      {auditError && (
        <StatusBanner tone="warning" role="status">
          {t("auditError")}
        </StatusBanner>
      )}
      <div className="flex min-w-0 items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="max-w-full truncate text-xs font-bold tracking-[0.1em] text-muted-foreground uppercase">
            {activeFilterLabel}
          </p>
          <h2 id="account-list-heading" className="mt-1 text-lg font-bold text-ink-strong">
            {t("title")}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span
            className="grid min-w-8 place-items-center rounded-full bg-gold-soft px-2 py-1 text-xs font-bold text-ink-strong"
            aria-label={t("count", { count: visibleAccounts.length })}
          >
            {visibleAccounts.length}
          </span>
          {current && (
            <AccountDirectoryControls
              vaults={vaultOptions}
              vaultFilters={activeVaultFilters}
              onVaultFiltersChange={(value) => {
                setPreferences((current) => ({ ...current, vaultFilters: value }));
              }}
              issuerFilters={activeIssuerFilters}
              onIssuerFiltersChange={setIssuerFilters}
              view={preferences.view}
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
                filterLabel: t("filterLabel"),
                filterByVault: t("filterByVault"),
                filterByIssuer: t("filterByIssuer"),
                allVaults: t("allVaults"),
                allIssuers: t("allIssuers"),
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
          )}
        </div>
      </div>
      <span className="sr-only" aria-live="polite">
        {lastMovedAccount && lastMovedPosition > 0
          ? t("reordered", { account: lastMovedAccount.accountName, position: lastMovedPosition })
          : ""}
      </span>
      {visibleAccounts.length ? (
        <ul
          ref={accountListRef}
          data-slot="account-directory-list"
          data-view-mode={preferences.view}
          className={cn(
            "grid list-none p-0 transition-[gap,grid-template-columns] duration-300 ease-out",
            preferences.view === "compact" && "grid-cols-1 gap-2 sm:grid-cols-2",
            preferences.view === "normal" && "grid-cols-1 gap-3",
            preferences.view === "wide" && "grid-cols-1 gap-4",
          )}
        >
          {visibleAccounts.map((account) => {
            const accountVault = workspace.vaults.find((vault) => vault.id === account.vaultId);
            const canEdit = current && accountVault?.effectiveAccountPermissions.permissions.canEditAccounts === true;
            const canDelete =
              current && accountVault?.effectiveAccountPermissions.permissions.canDeleteAccounts === true;
            const accountKey = accountDirectoryAccountKey(account);
            const vaultDetailHref =
              current && accountVault
                ? accountVault.type === "PERSONAL"
                  ? "/vaults/manage/personal"
                  : `/vaults/manage/${encodeURIComponent(accountVault.id)}`
                : undefined;
            const vaultDetailLabel =
              current && accountVault
                ? t("openAccountVault", { issuer: account.issuer, account: account.accountName })
                : undefined;
            return (
              <li key={accountKey} data-account-key={accountKey} className="min-w-0 rounded-lg">
                <TotpAccountButton
                  configuration={account}
                  vaultName={account.vaultName}
                  density={preferences.view}
                  vaultDetailHref={vaultDetailHref}
                  vaultDetailLabel={vaultDetailLabel}
                  onManage={canEdit || canDelete ? () => setManagedAccount(account) : undefined}
                  onAccess={
                    current && accountVault?.type === "SHARED"
                      ? async () => {
                          try {
                            await recordSharedVaultAccountAccess(account.vaultId, account.id);
                            setAuditError(false);
                          } catch {
                            setAuditError(true);
                          }
                        }
                      : undefined
                  }
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="grid justify-items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 p-8 text-center">
          <KeyRound className="size-7 text-taupe" aria-hidden="true" />
          <p className="font-bold text-foreground">
            {workspace.accounts.length && hasActiveFilters ? t("emptyFiltered") : t("empty")}
          </p>
          <p className="text-sm text-muted-foreground">
            {workspace.accounts.length && hasActiveFilters
              ? t("emptyFilteredDescription")
              : current
                ? t("emptyCurrent")
                : t("emptySnapshot")}
          </p>
          {current && !workspace.accounts.length && (
            <Button asChild className="mt-2">
              <Link href="/vaults/accounts/new">
                <Plus />
                {t("addAccount")}
              </Link>
            </Button>
          )}
        </div>
      )}
      {managedAccount &&
        (() => {
          const managedVault = workspace.vaults.find((vault) => vault.id === managedAccount.vaultId);
          if (!managedVault) return null;
          return (
            <AuthenticatorAccountManagerDialog
              account={managedAccount}
              vaultKey={managedVault.key}
              canEdit={managedVault.effectiveAccountPermissions.permissions.canEditAccounts}
              canDelete={managedVault.effectiveAccountPermissions.permissions.canDeleteAccounts}
              onPermissionChanged={refreshWorkspaceAuthorization}
              onUpdated={(updated) => {
                setManagedAccount(updated);
                setWorkspace((current) =>
                  current
                    ? {
                        ...current,
                        accounts: current.accounts.map((account) =>
                          account.id === updated.id && account.vaultId === updated.vaultId ? updated : account,
                        ),
                      }
                    : current,
                );
              }}
              onDeleted={(deleted) =>
                setWorkspace((current) =>
                  current
                    ? {
                        ...current,
                        accounts: current.accounts.filter(
                          (account) => account.id !== deleted.id || account.vaultId !== deleted.vaultId,
                        ),
                      }
                    : current,
                )
              }
              onClose={() => setManagedAccount(null)}
            />
          );
        })()}
    </section>
  );
}
