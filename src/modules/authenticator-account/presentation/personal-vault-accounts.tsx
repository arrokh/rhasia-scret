"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { PasskeyRecoveryEnrollment } from "@/modules/crypto";
import { TotpAccountButton } from "@/modules/otp-runtime";
import { FormFieldError, requiredText } from "@/shared/presentation/form-field-error";
import { SharedVaultManager } from "@/modules/vault-management";
import { useOnlineStatus } from "@/shared/presentation/use-online-status";
import { loadUnlockedVaultWorkspace, type WorkspaceAuthenticatorAccount } from "../infrastructure/browser-vault-workspace";
import { AuthenticatorAccountManagerDialog } from "./authenticator-account-manager-dialog";
import { useDeleteEncryptedAuthenticatorAccountMutation } from "./hooks/use-authenticator-account-mutations";
import { useUnlockedVaultWorkspace } from "./unlocked-vault-workspace-provider";

export function PersonalVaultAccounts({ vaultId }: { vaultId: string }) {
  const { workspace, setWorkspace } = useUnlockedVaultWorkspace();
  const [status, setStatus] = useState<"idle" | "error">("idle");
  const [managedAccount, setManagedAccount] = useState<WorkspaceAuthenticatorAccount | null>(null);
  const online = useOnlineStatus();
  const deleteAccountMutation = useDeleteEncryptedAuthenticatorAccountMutation();
  const unlockForm = useForm({
    defaultValues: { secret: "" },
    onSubmit: async ({ value }) => {
      setStatus("idle");
      try {
        setWorkspace(await loadUnlockedVaultWorkspace(value.secret, vaultId));
        unlockForm.reset();
      } catch {
        setStatus("error");
      }
    }
  });

  if (!workspace) {
    return (
      <form noValidate className="auth-form vault-unlock-form" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void unlockForm.handleSubmit(); }}>
        <p className="vault-flow-title">Buka brankas Anda</p>
        <p className="vault-flow-copy">Passphrase Brankas Anda tetap di perangkat ini dan tidak pernah dikirim ke layanan.</p>
        <unlockForm.Field name="secret" validators={{ onSubmit: requiredText("Passphrase Brankas") }}>
          {(field) => <><label htmlFor="vault-unlock-secret">Passphrase Brankas</label><input id="vault-unlock-secret" type="password" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "vault-unlock-secret-error" : undefined} required /><FormFieldError id="vault-unlock-secret-error" errors={field.state.meta.errors} /></>}
        </unlockForm.Field>
        <unlockForm.Subscribe selector={(formState) => formState.isSubmitting}>
          {(isSubmitting) => <button className="primary-button" type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>{isSubmitting ? "Membuka semua brankas…" : "Buka Brankas"}</button>}
        </unlockForm.Subscribe>
        <Link className="secondary-link" href="/vaults/recovery">Lupa Passphrase Brankas?</Link>
        {status === "error" && <p role="alert">Tidak dapat membuka brankas Anda.</p>}
      </form>
    );
  }

  const sharedVaults = workspace.vaults
    .filter((vault) => vault.type === "SHARED")
    .map((vault) => ({
      id: vault.id,
      name: vault.name,
      role: vault.role,
      key: vault.key,
      accounts: workspace.accounts
        .filter((account) => account.vaultId === vault.id)
        .map(({ id, issuer, accountName, revision }) => ({ id, issuer, accountName, revision }))
    }));

  return (
    <section className="vault-dashboard" aria-labelledby="account-list-heading">
      <div className="dashboard-toolbar">
        <SharedVaultManager
          userRootKey={workspace.userRootKey}
          vaults={sharedVaults}
          onVaultCreated={(vault) => setWorkspace((current) => current ? {
            ...current,
            vaults: [...current.vaults, { ...vault, type: "SHARED", role: "OWNER" }]
          } : current)}
          onVaultRenamed={(vaultId, name) => setWorkspace((current) => current ? {
            ...current,
            vaults: current.vaults.map((vault) => vault.id === vaultId ? { ...vault, name } : vault),
            accounts: current.accounts.map((account) => account.vaultId === vaultId ? { ...account, vaultName: name } : account)
          } : current)}
          onAccountDeleted={async (vaultId, accountId, expectedRevision) => {
            await deleteAccountMutation.mutateAsync({ vaultId, vaultType: "SHARED", accountId, expectedRevision });
            setWorkspace((current) => current ? { ...current, accounts: current.accounts.filter((account) => account.id !== accountId || account.vaultId !== vaultId) } : current);
          }}
        />
        <details className="security-menu">
          <summary><SecurityIcon /><span>Keamanan</span></summary>
          <PasskeyRecoveryEnrollment userRootKey={workspace.userRootKey} />
        </details>
        <Link className="add-account-link" href="/vaults/accounts/new" aria-label="Tambahkan akun autentikator">
          <PlusIcon />
          <span>Tambah akun</span>
        </Link>
      </div>
      {!online && <p className="offline-notice" role="status">Luring: akun tersedia hanya baca; perubahan diblokir dan tidak pernah diantrikan.</p>}
      {workspace.unavailableSharedVaults > 0 && <p className="form-status" role="alert">{workspace.unavailableSharedVaults} Brankas Bersama tidak dapat dibuka. Akun dari brankas lain tetap tersedia.</p>}
      <div className="vault-accounts-heading">
        <div><p className="eyebrow">SEMUA BRANKAS</p><h2 id="account-list-heading">Akun autentikator</h2></div>
        <span className="account-count" aria-label={`${workspace.accounts.length} akun`}>{workspace.accounts.length}</span>
      </div>
      {workspace.accounts.length ? (
        <ul className="account-list account-list-across-vaults">
          {workspace.accounts.map((account) => {
            const accountVault = workspace.vaults.find((vault) => vault.id === account.vaultId);
            const writable = accountVault?.type === "PERSONAL" || accountVault?.role === "OWNER";
            return (
              <li key={`${account.vaultId}:${account.id}`}>
                <TotpAccountButton configuration={account} vaultName={account.vaultName} onManage={writable ? () => setManagedAccount(account) : undefined} />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="empty-accounts">Belum ada akun autentikator di brankas yang dapat Anda akses.</p>
      )}
      {managedAccount && (() => {
        const managedVault = workspace.vaults.find((vault) => vault.id === managedAccount.vaultId);
        if (!managedVault) return null;
        return (
          <AuthenticatorAccountManagerDialog
            account={managedAccount}
            vaultKey={managedVault.key}
            onUpdated={(updated) => {
              setManagedAccount(updated);
              setWorkspace((current) => current ? { ...current, accounts: current.accounts.map((account) => account.id === updated.id && account.vaultId === updated.vaultId ? updated : account) } : current);
            }}
            onDeleted={(deleted) => setWorkspace((current) => current ? { ...current, accounts: current.accounts.filter((account) => account.id !== deleted.id || account.vaultId !== deleted.vaultId) } : current)}
            onClose={() => setManagedAccount(null)}
          />
        );
      })()}
    </section>
  );
}

function PlusIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
}

function SecurityIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.6 2.9 8.4 7 10 4.1-1.6 7-5.4 7-10V6l-7-3Z" /></svg>;
}
