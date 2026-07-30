"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeftRight, KeyRound, Plus, ShieldKeyhole, Vault } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { PasskeyRecoveryEnrollment, RememberedBrowserEnrollment } from "@/modules/crypto";
import { TotpAccountButton } from "@/modules/otp-runtime";
import { VaultStatusIndicator } from "@/modules/sync";
import { recordSharedVaultAccountAccess } from "@/modules/vault-management";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { LocalVaultCopyPanel } from "@/modules/local-vault";
import type { WorkspaceAuthenticatorAccount } from "../infrastructure/browser-vault-workspace";
import { AuthenticatorAccountManagerDialog } from "./authenticator-account-manager-dialog";
import { useUnlockedVaultWorkspace } from "./unlocked-vault-workspace-provider";
import { VaultWorkspaceUnlock } from "./vault-workspace-unlock";

export function PersonalVaultAccounts({ vaultId }: { vaultId: string }) {
  const t = useTranslations("AuthenticatorAccount.accounts");
  const { workspace, setWorkspace, refreshWorkspaceAuthorization } = useUnlockedVaultWorkspace();
  const [managedAccount, setManagedAccount] = useState<WorkspaceAuthenticatorAccount | null>(null);
  const [auditError, setAuditError] = useState(false);

  if (!workspace) return <VaultWorkspaceUnlock personalVaultId={vaultId} onUnlocked={setWorkspace} />;
  const current = workspace.syncState === "CURRENT";
  const personalVault = workspace.vaults.find((vault) => vault.id === vaultId && vault.type === "PERSONAL");
  const personalAccounts = workspace.accounts.filter((account) => account.vaultId === vaultId && account.vaultType === "PERSONAL");

  return (
    <section className="grid gap-5 p-4 sm:p-5" aria-labelledby="account-list-heading">
      <div className="flex items-center gap-2">
        {current && <Button variant="outline" asChild><Link href="/vaults/manage" prefetch={true} aria-label={t("vaults")} title={t("vaults")}><Vault aria-hidden="true" /><span className="hidden sm:inline">{t("vaults")}</span></Link></Button>}
        {current && personalVault && <Sheet>
          <SheetTrigger asChild><Button variant="outline" aria-label={t("localAction")}><ArrowLeftRight aria-hidden="true" /><span>{t("localAction")}</span></Button></SheetTrigger>
          <SheetContent side="bottom" className="max-h-[85dvh] gap-5 overflow-y-auto rounded-t-xl border-border bg-card px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-sheet sm:mx-auto sm:max-w-lg">
            <SheetHeader className="p-0 pt-5"><SheetTitle>{t("localTitle")}</SheetTitle><SheetDescription>{t("localDescription")}</SheetDescription></SheetHeader>
            <LocalVaultCopyPanel personalVaultId={personalVault.id} personalVaultName={personalVault.name} personalVaultKey={personalVault.key} personalAccounts={personalAccounts} onPersonalAccountsCopied={(accounts) => setWorkspace((value) => value ? { ...value, accounts: [...value.accounts, ...accounts] } : value)} />
          </SheetContent>
        </Sheet>}
        {current && <Sheet>
          <SheetTrigger asChild><Button variant="outline" aria-label={t("securityAction")}><ShieldKeyhole aria-hidden="true" /><span>{t("securityAction")}</span></Button></SheetTrigger>
          <SheetContent side="bottom" className="gap-5 rounded-t-xl border-border bg-card px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-sheet sm:mx-auto sm:max-w-lg">
            <SheetHeader className="p-0 pt-5"><SheetTitle>{t("security")}</SheetTitle><SheetDescription>{t("securityDescription")}</SheetDescription></SheetHeader>
            <div className="grid gap-4"><PasskeyRecoveryEnrollment userRootKey={workspace.userRootKey} /><RememberedBrowserEnrollment profileId={workspace.profileId} userRootKey={workspace.userRootKey} /></div>
          </SheetContent>
        </Sheet>}
        {current && <Button asChild className="ml-auto"><Link href="/vaults/accounts/new" aria-label={t("addAccountLabel")}><Plus /><span className="hidden sm:inline">{t("addAccount")}</span></Link></Button>}
      </div>
      <VaultStatusIndicator origin="PERSONAL" syncState={workspace.syncState} lastSynchronizedAt={workspace.synchronizedAt} collapsible />
      {workspace.unavailableSharedVaults > 0 && <StatusBanner tone="danger" role="alert">{t("unavailableVaults", { count: workspace.unavailableSharedVaults })}</StatusBanner>}
      {auditError && <StatusBanner tone="warning" role="status">{t("auditError")}</StatusBanner>}
      <div className="flex items-end justify-between gap-4">
        <div><p className="text-xs font-bold tracking-[0.1em] text-muted-foreground uppercase">{t("allVaults")}</p><h2 id="account-list-heading" className="mt-1 text-lg font-bold text-ink-strong">{t("title")}</h2></div>
        <span className="grid min-w-8 place-items-center rounded-full bg-gold-soft px-2 py-1 text-xs font-bold text-ink-strong" aria-label={t("count", { count: workspace.accounts.length })}>{workspace.accounts.length}</span>
      </div>
      {workspace.accounts.length ? (
        <ul className="grid list-none gap-3 p-0">
          {workspace.accounts.map((account) => {
            const accountVault = workspace.vaults.find((vault) => vault.id === account.vaultId);
            const canEdit = current && accountVault?.effectiveAccountPermissions.permissions.canEditAccounts === true;
            const canDelete = current && accountVault?.effectiveAccountPermissions.permissions.canDeleteAccounts === true;
            return <li key={`${account.vaultId}:${account.id}`}><TotpAccountButton configuration={account} vaultName={account.vaultName} onManage={canEdit || canDelete ? () => setManagedAccount(account) : undefined} onAccess={current && accountVault?.type === "SHARED" ? async () => { try { await recordSharedVaultAccountAccess(account.vaultId, account.id); setAuditError(false); } catch { setAuditError(true); } } : undefined} /></li>;
          })}
        </ul>
      ) : (
        <div className="grid justify-items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 p-8 text-center"><KeyRound className="size-7 text-taupe" aria-hidden="true" /><p className="font-bold text-foreground">{t("empty")}</p><p className="text-sm text-muted-foreground">{current ? t("emptyCurrent") : t("emptySnapshot")}</p>{current && <Button asChild className="mt-2"><Link href="/vaults/accounts/new"><Plus />{t("addAccount")}</Link></Button>}</div>
      )}
      {managedAccount && (() => { const managedVault = workspace.vaults.find((vault) => vault.id === managedAccount.vaultId); if (!managedVault) return null; return <AuthenticatorAccountManagerDialog account={managedAccount} vaultKey={managedVault.key} canEdit={managedVault.effectiveAccountPermissions.permissions.canEditAccounts} canDelete={managedVault.effectiveAccountPermissions.permissions.canDeleteAccounts} onPermissionChanged={refreshWorkspaceAuthorization} onUpdated={(updated) => { setManagedAccount(updated); setWorkspace((current) => current ? { ...current, accounts: current.accounts.map((account) => account.id === updated.id && account.vaultId === updated.vaultId ? updated : account) } : current); }} onDeleted={(deleted) => setWorkspace((current) => current ? { ...current, accounts: current.accounts.filter((account) => account.id !== deleted.id || account.vaultId !== deleted.vaultId) } : current)} onClose={() => setManagedAccount(null)} />; })()}
    </section>
  );
}
