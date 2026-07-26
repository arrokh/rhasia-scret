"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { PasskeyRecoveryEnrollment } from "@/modules/crypto";
import { SharedVaultManager } from "@/modules/vault-management";
import { useOnlineStatus } from "@/shared/presentation/use-online-status";
import {
  loadUnlockedVaultWorkspace,
  type UnlockedVaultWorkspace
} from "../infrastructure/browser-vault-workspace";

export function PersonalVaultAccounts({ vaultId }: { vaultId: string }) {
  const [workspace, setWorkspace] = useState<UnlockedVaultWorkspace | null>(null);
  const [secret, setSecret] = useState("");
  const [status, setStatus] = useState<"idle" | "unlocking" | "error">("idle");
  const online = useOnlineStatus();

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("unlocking");
    try {
      setWorkspace(await loadUnlockedVaultWorkspace(secret, vaultId));
      setSecret("");
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  if (!workspace) {
    return (
      <form className="auth-form vault-unlock-form" onSubmit={unlock}>
        <p className="vault-flow-title">Buka brankas Anda</p>
        <p className="vault-flow-copy">Passphrase Brankas Anda tetap di perangkat ini dan tidak pernah dikirim ke layanan.</p>
        <label htmlFor="vault-unlock-secret">Passphrase Brankas</label>
        <input id="vault-unlock-secret" type="password" value={secret} onChange={(event) => setSecret(event.target.value)} required />
        <button className="primary-button" type="submit" disabled={status === "unlocking"} aria-busy={status === "unlocking"}>
          {status === "unlocking" ? "Membuka semua brankas…" : "Buka Brankas"}
        </button>
        <Link className="secondary-link" href="/vaults/recovery">Lupa Passphrase Brankas?</Link>
        {status === "error" && <p role="alert">Tidak dapat membuka brankas Anda.</p>}
      </form>
    );
  }

  const sharedVaults = workspace.vaults
    .filter((vault) => vault.type === "SHARED")
    .map((vault) => ({ id: vault.id, name: vault.name, role: vault.role }));

  return (
    <section className="vault-dashboard" aria-labelledby="account-list-heading">
      <div className="dashboard-toolbar">
        <SharedVaultManager userRootKey={workspace.userRootKey} vaults={sharedVaults} />
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
          {workspace.accounts.map((account) => (
            <li key={`${account.vaultId}:${account.id}`}>
              <span className="account-avatar" aria-hidden="true">{account.issuer.slice(0, 1).toUpperCase()}</span>
              <span className="account-copy"><strong>{account.issuer}</strong><span>{account.accountName}</span></span>
              <small className="vault-badge">{account.vaultName}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-accounts">Belum ada akun autentikator di brankas yang dapat Anda akses.</p>
      )}
    </section>
  );
}

function PlusIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
}

function SecurityIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.6 2.9 8.4 7 10 4.1-1.6 7-5.4 7-10V6l-7-3Z" /></svg>;
}
