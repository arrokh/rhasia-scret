"use client";

import Link from "next/link";
import { useState } from "react";
import { KeyRound, Plus, ShieldKeyhole, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { PasskeyRecoveryEnrollment } from "@/modules/crypto";
import { TotpAccountButton } from "@/modules/otp-runtime";
import { recordSharedVaultAccountAccess } from "@/modules/vault-management";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { useOnlineStatus } from "@/shared/presentation/use-online-status";
import type { WorkspaceAuthenticatorAccount } from "../infrastructure/browser-vault-workspace";
import { AuthenticatorAccountManagerDialog } from "./authenticator-account-manager-dialog";
import { useUnlockedVaultWorkspace } from "./unlocked-vault-workspace-provider";
import { VaultWorkspaceUnlock } from "./vault-workspace-unlock";

export function PersonalVaultAccounts({ vaultId }: { vaultId: string }) {
  const { workspace, setWorkspace } = useUnlockedVaultWorkspace();
  const [managedAccount, setManagedAccount] = useState<WorkspaceAuthenticatorAccount | null>(null);
  const [auditError, setAuditError] = useState(false);
  const online = useOnlineStatus();

  if (!workspace) return <VaultWorkspaceUnlock personalVaultId={vaultId} onUnlocked={setWorkspace} />;

  return (
    <section className="grid gap-5 p-4 sm:p-5" aria-labelledby="account-list-heading">
      <div className="flex items-center gap-2">
        <Button variant="outline" asChild><Link href="/vaults/manage" aria-label="Brankas" title="Brankas"><UsersRound aria-hidden="true" /><span className="hidden sm:inline">Brankas</span></Link></Button>
        <Sheet>
          <SheetTrigger asChild><Button variant="outline" size="icon" aria-label="Keamanan brankas"><ShieldKeyhole /></Button></SheetTrigger>
          <SheetContent side="bottom" className="gap-5 rounded-t-xl border-border bg-card px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-sheet sm:mx-auto sm:max-w-lg">
            <SheetHeader className="p-0 pt-5"><SheetTitle>Keamanan brankas</SheetTitle><SheetDescription>Tambahkan jalur pemulihan yang tetap menjaga kunci di perangkat Anda.</SheetDescription></SheetHeader>
            <div><PasskeyRecoveryEnrollment userRootKey={workspace.userRootKey} /></div>
          </SheetContent>
        </Sheet>
        <Button asChild className="ml-auto"><Link href="/vaults/accounts/new" aria-label="Tambahkan akun autentikator"><Plus /><span className="hidden sm:inline">Tambah akun</span></Link></Button>
      </div>
      {!online && <StatusBanner tone="offline">Anda luring. Kode tersimpan tetap bekerja; perubahan diblokir dan tidak diantrikan.</StatusBanner>}
      {workspace.unavailableSharedVaults > 0 && <StatusBanner tone="danger" role="alert">{workspace.unavailableSharedVaults} Brankas Bersama tidak dapat dibuka. Akun dari brankas lain tetap tersedia.</StatusBanner>}
      {auditError && <StatusBanner tone="warning" role="status">OTP tetap disalin, tetapi riwayat akses Brankas Bersama tidak dapat dicatat.</StatusBanner>}
      <div className="flex items-end justify-between gap-4">
        <div><p className="text-xs font-bold tracking-[0.1em] text-muted-foreground uppercase">Semua brankas</p><h2 id="account-list-heading" className="mt-1 text-lg font-bold text-ink-strong">Akun autentikator</h2></div>
        <span className="grid min-w-8 place-items-center rounded-full bg-gold-soft px-2 py-1 text-xs font-bold text-ink-strong" aria-label={`${workspace.accounts.length} akun`}>{workspace.accounts.length}</span>
      </div>
      {workspace.accounts.length ? (
        <ul className="grid list-none gap-3 p-0">
          {workspace.accounts.map((account) => {
            const accountVault = workspace.vaults.find((vault) => vault.id === account.vaultId);
            const writable = accountVault?.type === "PERSONAL" || accountVault?.role === "OWNER";
            return <li key={`${account.vaultId}:${account.id}`}><TotpAccountButton configuration={account} vaultName={account.vaultName} onManage={writable ? () => setManagedAccount(account) : undefined} onAccess={accountVault?.type === "SHARED" ? async () => { try { await recordSharedVaultAccountAccess(account.vaultId, account.id); setAuditError(false); } catch { setAuditError(true); } } : undefined} /></li>;
          })}
        </ul>
      ) : (
        <div className="grid justify-items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 p-8 text-center"><KeyRound className="size-7 text-taupe" aria-hidden="true" /><p className="font-bold text-foreground">Belum ada akun autentikator</p><p className="text-sm text-muted-foreground">Tambahkan akun pertama dengan memindai kode QR.</p><Button asChild className="mt-2"><Link href="/vaults/accounts/new"><Plus />Tambah akun</Link></Button></div>
      )}
      {managedAccount && (() => { const managedVault = workspace.vaults.find((vault) => vault.id === managedAccount.vaultId); if (!managedVault) return null; return <AuthenticatorAccountManagerDialog account={managedAccount} vaultKey={managedVault.key} onUpdated={(updated) => { setManagedAccount(updated); setWorkspace((current) => current ? { ...current, accounts: current.accounts.map((account) => account.id === updated.id && account.vaultId === updated.vaultId ? updated : account) } : current); }} onDeleted={(deleted) => setWorkspace((current) => current ? { ...current, accounts: current.accounts.filter((account) => account.id !== deleted.id || account.vaultId !== deleted.vaultId) } : current)} onClose={() => setManagedAccount(null)} />; })()}
    </section>
  );
}
