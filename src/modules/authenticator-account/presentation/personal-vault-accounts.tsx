"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Fingerprint, KeyRound, LoaderCircle, Plus, ShieldKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { PasskeyRecoveryEnrollment } from "@/modules/crypto";
import { usePasskeyRecoveryStatusQuery } from "@/modules/identity";
import { TotpAccountButton } from "@/modules/otp-runtime";
import { SharedVaultManager } from "@/modules/vault-management";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { FormFieldError, requiredText } from "@/shared/presentation/form-field-error";
import { useOnlineStatus } from "@/shared/presentation/use-online-status";
import { loadUnlockedVaultWorkspace, loadUnlockedVaultWorkspaceWithPasskey, type WorkspaceAuthenticatorAccount } from "../infrastructure/browser-vault-workspace";
import { AuthenticatorAccountManagerDialog } from "./authenticator-account-manager-dialog";
import { useDeleteEncryptedAuthenticatorAccountMutation } from "./hooks/use-authenticator-account-mutations";
import { useUnlockedVaultWorkspace } from "./unlocked-vault-workspace-provider";

export function PersonalVaultAccounts({ vaultId }: { vaultId: string }) {
  const { workspace, setWorkspace } = useUnlockedVaultWorkspace();
  const [status, setStatus] = useState<"idle" | "secret_error" | "passkey_error">("idle");
  const [passkeyUnlocking, setPasskeyUnlocking] = useState(false);
  const [managedAccount, setManagedAccount] = useState<WorkspaceAuthenticatorAccount | null>(null);
  const online = useOnlineStatus();
  const recoveryStatus = usePasskeyRecoveryStatusQuery(!workspace);
  const deleteAccountMutation = useDeleteEncryptedAuthenticatorAccountMutation();
  const unlockForm = useForm({
    defaultValues: { secret: "" },
    onSubmit: async ({ value }) => {
      setStatus("idle");
      try { setWorkspace(await loadUnlockedVaultWorkspace(value.secret, vaultId)); unlockForm.reset(); }
      catch { setStatus("secret_error"); }
    }
  });

  async function unlockWithPasskey() {
    setStatus("idle");
    setPasskeyUnlocking(true);
    try { setWorkspace(await loadUnlockedVaultWorkspaceWithPasskey(vaultId)); unlockForm.reset(); }
    catch { setStatus("passkey_error"); }
    finally { setPasskeyUnlocking(false); }
  }

  if (!workspace) {
    return (
      <form noValidate className="grid gap-5 p-5 sm:p-6" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void unlockForm.handleSubmit(); }}>
        <div className="grid justify-items-center gap-3 text-center">
          <span className="grid size-16 place-items-center rounded-xl bg-gold-soft text-ink-strong" aria-hidden="true"><KeyRound className="size-7" /></span>
          <div><h2 className="text-xl font-bold text-ink-strong">Brankas Anda terkunci</h2><p className="mt-1 text-sm leading-5 text-muted-foreground">Buka untuk mengakses kode autentikator. Passphrase tetap di perangkat ini.</p></div>
        </div>
        <unlockForm.Field name="secret" validators={{ onSubmit: requiredText("Passphrase Brankas") }}>
          {(field) => <div className="grid gap-2"><Label htmlFor="vault-unlock-secret">Passphrase Brankas</Label><Input id="vault-unlock-secret" type="password" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "vault-unlock-secret-error" : undefined} disabled={passkeyUnlocking} required autoComplete="current-password" /><FormFieldError id="vault-unlock-secret-error" errors={field.state.meta.errors} /></div>}
        </unlockForm.Field>
        <unlockForm.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <Button type="submit" className="w-full" disabled={isSubmitting || passkeyUnlocking} aria-busy={isSubmitting}>{isSubmitting ? "Membuka semua brankas…" : "Buka Brankas"}</Button>}</unlockForm.Subscribe>
        {recoveryStatus.data?.enrolled && <><div className="flex items-center gap-3 text-xs text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">atau</div><Button variant="outline" type="button" onClick={() => void unlockWithPasskey()} disabled={passkeyUnlocking} aria-busy={passkeyUnlocking}>{passkeyUnlocking ? <LoaderCircle className="animate-spin" /> : <Fingerprint />}{passkeyUnlocking ? "Memverifikasi passkey…" : "Buka dengan passkey"}</Button></>}
        <Button variant="link" asChild><Link href="/vaults/recovery">Lupa Passphrase Brankas?</Link></Button>
        {status === "secret_error" && <StatusBanner tone="danger" role="alert">Passphrase Brankas tidak dapat membuka brankas Anda.</StatusBanner>}
        {status === "passkey_error" && <StatusBanner tone="danger" role="alert">Passkey tidak dapat membuka brankas. Coba lagi atau gunakan Passphrase Brankas.</StatusBanner>}
      </form>
    );
  }

  const sharedVaults = workspace.vaults.filter((vault) => vault.type === "SHARED").map((vault) => ({ id: vault.id, name: vault.name, role: vault.role, key: vault.key, accounts: workspace.accounts.filter((account) => account.vaultId === vault.id).map(({ id, issuer, accountName, revision }) => ({ id, issuer, accountName, revision })) }));

  return (
    <section className="grid gap-5 p-4 sm:p-5" aria-labelledby="account-list-heading">
      <div className="flex items-center gap-2">
        <SharedVaultManager userRootKey={workspace.userRootKey} vaults={sharedVaults} onVaultCreated={(vault) => setWorkspace((current) => current ? { ...current, vaults: [...current.vaults, { ...vault, type: "SHARED", role: "OWNER" }] } : current)} onVaultRenamed={(vaultId, name) => setWorkspace((current) => current ? { ...current, vaults: current.vaults.map((vault) => vault.id === vaultId ? { ...vault, name } : vault), accounts: current.accounts.map((account) => account.vaultId === vaultId ? { ...account, vaultName: name } : account) } : current)} onAccountDeleted={async (vaultId, accountId, expectedRevision) => { await deleteAccountMutation.mutateAsync({ vaultId, vaultType: "SHARED", accountId, expectedRevision }); setWorkspace((current) => current ? { ...current, accounts: current.accounts.filter((account) => account.id !== accountId || account.vaultId !== vaultId) } : current); }} />
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
      <div className="flex items-end justify-between gap-4">
        <div><p className="text-xs font-bold tracking-[0.1em] text-muted-foreground uppercase">Semua brankas</p><h2 id="account-list-heading" className="mt-1 text-lg font-bold text-ink-strong">Akun autentikator</h2></div>
        <span className="grid min-w-8 place-items-center rounded-full bg-gold-soft px-2 py-1 text-xs font-bold text-ink-strong" aria-label={`${workspace.accounts.length} akun`}>{workspace.accounts.length}</span>
      </div>
      {workspace.accounts.length ? (
        <ul className="grid list-none gap-3 p-0">
          {workspace.accounts.map((account) => {
            const accountVault = workspace.vaults.find((vault) => vault.id === account.vaultId);
            const writable = accountVault?.type === "PERSONAL" || accountVault?.role === "OWNER";
            return <li key={`${account.vaultId}:${account.id}`}><TotpAccountButton configuration={account} vaultName={account.vaultName} onManage={writable ? () => setManagedAccount(account) : undefined} /></li>;
          })}
        </ul>
      ) : (
        <div className="grid justify-items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 p-8 text-center"><KeyRound className="size-7 text-taupe" aria-hidden="true" /><p className="font-bold text-foreground">Belum ada akun autentikator</p><p className="text-sm text-muted-foreground">Tambahkan akun pertama dengan memindai kode QR.</p><Button asChild className="mt-2"><Link href="/vaults/accounts/new"><Plus />Tambah akun</Link></Button></div>
      )}
      {managedAccount && (() => { const managedVault = workspace.vaults.find((vault) => vault.id === managedAccount.vaultId); if (!managedVault) return null; return <AuthenticatorAccountManagerDialog account={managedAccount} vaultKey={managedVault.key} onUpdated={(updated) => { setManagedAccount(updated); setWorkspace((current) => current ? { ...current, accounts: current.accounts.map((account) => account.id === updated.id && account.vaultId === updated.vaultId ? updated : account) } : current); }} onDeleted={(deleted) => setWorkspace((current) => current ? { ...current, accounts: current.accounts.filter((account) => account.id !== deleted.id || account.vaultId !== deleted.vaultId) } : current)} onClose={() => setManagedAccount(null)} />; })()}
    </section>
  );
}
