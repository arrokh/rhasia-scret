"use client";

import { useState, type FormEvent } from "react";
import { createUserEncryptionIdentity, PasskeyRecoveryEnrollment, serializeEncryptedEnvelope, unlockPersonalVault } from "@/modules/crypto";
import { decryptAccountConfiguration, encryptAccountConfiguration, isDuplicateAccount, sortAccounts, type DecryptedAuthenticatorAccount } from "../infrastructure/browser-account-payload";
import { parseTotpUri } from "@/modules/otp-runtime";
import { SharedVaultCreator } from "@/modules/vault-management";
import { QrImportInput } from "./qr-import-input";
import { useOnlineStatus } from "@/shared/presentation/use-online-status";

type ProfileResponse = { vaultUnlockSalt: string; wrappedUserRootKey: string; encryptedPersonalVaultKey: string; encryptionVersion: number; userEncryptionPublicKey?: JsonWebKey; encryptedUserPrivateKey?: string };
type AccountResponse = { id: string; encryptedPayload: string };

export function PersonalVaultAccounts({ vaultId }: { vaultId: string }) {
  const [accounts, setAccounts] = useState<DecryptedAuthenticatorAccount[]>([]);
  const [vaultKey, setVaultKey] = useState<Uint8Array | null>(null);
  const [userRootKey, setUserRootKey] = useState<Uint8Array | null>(null);
  const [secret, setSecret] = useState("");
  const [uri, setUri] = useState("");
  const [error, setError] = useState("");
  const [duplicate, setDuplicate] = useState<DecryptedAuthenticatorAccount | null>(null);
  const online = useOnlineStatus();

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const profile = await fetchJson<ProfileResponse>("/api/user-crypto-profile");
      const unlocked = await unlockPersonalVault(secret, {
        vaultUnlockSalt: fromBase64(profile.vaultUnlockSalt),
        wrappedUserRootKey: fromBase64(profile.wrappedUserRootKey),
        encryptedPersonalVaultKey: fromBase64(profile.encryptedPersonalVaultKey),
        encryptionVersion: profile.encryptionVersion
      });
      if (!profile.userEncryptionPublicKey || !profile.encryptedUserPrivateKey) {
        const identity = await createUserEncryptionIdentity(unlocked.userRootKey);
        const response = await fetch("/api/user-encryption-identity", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ publicKey: identity.publicKey, encryptedPrivateKey: toBase64(serializeEncryptedEnvelope(identity.encryptedPrivateKey)), encryptionVersion: 1 })
        });
        if (!response.ok) throw new Error("Tidak dapat mendaftarkan identitas enkripsi pengguna.");
      }
      const stored = await fetchJson<AccountResponse[]>(`/api/vaults/${vaultId}/accounts`);
      const decrypted = await Promise.all(stored.map((account) => decryptAccountConfiguration(unlocked.personalVaultKey, fromBase64(account.encryptedPayload))));
      setVaultKey(unlocked.personalVaultKey);
      setUserRootKey(unlocked.userRootKey);
      setAccounts(sortAccounts(decrypted));
      setSecret("");
      setError("");
    } catch {
      setError("Tidak dapat membuka Brankas Pribadi ini.");
    }
  }

  async function saveAccount(candidate: DecryptedAuthenticatorAccount) {
    if (!vaultKey || !online) return;
    const encryptedPayload = await encryptAccountConfiguration(vaultKey, candidate);
    const response = await fetch(`/api/vaults/${vaultId}/accounts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ encryptedPayload: toBase64(encryptedPayload), encryptionVersion: 1 }) });
    if (!response.ok) throw new Error("Tidak dapat menyimpan akun.");
    setAccounts(sortAccounts([...accounts, candidate]));
    setUri("");
    setDuplicate(null);
    setError("");
  }

  async function addAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!online) { setError("Anda sedang luring. Perubahan akun diblokir dan tidak pernah diantrikan."); return; }
    try {
      const candidate = parseTotpUri(uri);
      if (isDuplicateAccount(candidate, accounts)) {
        setDuplicate(candidate);
        return;
      }
      await saveAccount(candidate);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Tidak dapat menambahkan akun ini.");
    }
  }

  async function addDuplicateAnyway() {
    if (!duplicate) return;
    try {
      await saveAccount(duplicate);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Tidak dapat menambahkan akun ini.");
    }
  }

  if (!vaultKey) return <form className="auth-form vault-unlock-form" onSubmit={unlock}><p className="vault-flow-title">Buka brankas Anda</p><p className="vault-flow-copy">Rahasia pembuka Anda tetap di perangkat ini dan tidak pernah dikirim ke layanan.</p><label htmlFor="vault-unlock-secret">Rahasia Pembuka Brankas</label><input id="vault-unlock-secret" type="password" value={secret} onChange={(event) => setSecret(event.target.value)} required /><button className="primary-button" type="submit">Buka Brankas Pribadi</button>{error && <p role="alert">{error}</p>}</form>;
  return <section className="vault-accounts"><div className="vault-accounts-heading"><div><p className="eyebrow">AUTENTIKATOR</p><h2>Akun Brankas Pribadi</h2></div><span className="account-count" aria-label={`${accounts.length} akun`}>{accounts.length}</span></div>{!online && <p className="offline-notice" role="status">Luring: akses hanya baca tersedia; perubahan diblokir dan tidak pernah diantrikan.</p>}{userRootKey && <><SharedVaultCreator userRootKey={userRootKey} /><PasskeyRecoveryEnrollment userRootKey={userRootKey} /></>}{accounts.length ? <ul className="account-list">{accounts.map((account) => <li key={`${account.issuer}:${account.accountName}`}><strong>{account.issuer}</strong><span>{account.accountName}</span></li>)}</ul> : <p className="empty-accounts">Belum ada akun. Tambahkan akun dari kode QR atau URI autentikator.</p>}<QrImportInput onUri={setUri} /><form className="auth-form add-account-form" onSubmit={(event) => void addAccount(event)}><label htmlFor="account-uri">URI autentikator</label><input id="account-uri" value={uri} onChange={(event) => setUri(event.target.value)} required disabled={!online} /><button className="primary-button" type="submit" disabled={!online}>Tambahkan akun terenkripsi</button></form>{duplicate && <aside className="duplicate-account"><p>Akun yang sama sudah ada.</p><button type="button" onClick={() => setDuplicate(null)}>Batal</button><button type="button" onClick={() => void addDuplicateAnyway()} disabled={!online}>Tetap tambahkan</button></aside>}{error && <p role="alert">{error}</p>}</section>;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Request failed.");
  return response.json() as Promise<T>;
}
function fromBase64(value: string): Uint8Array { const binary = atob(value); return Uint8Array.from(binary, (character) => character.charCodeAt(0)); }
function toBase64(bytes: Uint8Array): string { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
