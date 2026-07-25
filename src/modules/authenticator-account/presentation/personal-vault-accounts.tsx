"use client";

import { useState, type FormEvent } from "react";
import { createUserEncryptionIdentity, serializeEncryptedEnvelope, unlockPersonalVault } from "@/modules/crypto";
import { decryptAccountConfiguration, encryptAccountConfiguration, isDuplicateAccount, sortAccounts, type DecryptedAuthenticatorAccount } from "../infrastructure/browser-account-payload";
import { parseTotpUri } from "@/modules/otp-runtime";
import { SharedVaultCreator } from "@/modules/vault-management";
import { QrImportInput } from "./qr-import-input";

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
        if (!response.ok) throw new Error("Unable to register user encryption identity.");
      }
      const stored = await fetchJson<AccountResponse[]>(`/api/vaults/${vaultId}/accounts`);
      const decrypted = await Promise.all(stored.map((account) => decryptAccountConfiguration(unlocked.personalVaultKey, fromBase64(account.encryptedPayload))));
      setVaultKey(unlocked.personalVaultKey);
      setUserRootKey(unlocked.userRootKey);
      setAccounts(sortAccounts(decrypted));
      setSecret("");
      setError("");
    } catch {
      setError("Unable to unlock this Personal Vault.");
    }
  }

  async function saveAccount(candidate: DecryptedAuthenticatorAccount) {
    if (!vaultKey) return;
    const encryptedPayload = await encryptAccountConfiguration(vaultKey, candidate);
    const response = await fetch(`/api/vaults/${vaultId}/accounts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ encryptedPayload: toBase64(encryptedPayload), encryptionVersion: 1 }) });
    if (!response.ok) throw new Error("save failed");
    setAccounts(sortAccounts([...accounts, candidate]));
    setUri("");
    setDuplicate(null);
    setError("");
  }

  async function addAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const candidate = parseTotpUri(uri);
      if (isDuplicateAccount(candidate, accounts)) {
        setDuplicate(candidate);
        return;
      }
      await saveAccount(candidate);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to add this account.");
    }
  }

  async function addDuplicateAnyway() {
    if (!duplicate) return;
    try {
      await saveAccount(duplicate);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to add this account.");
    }
  }

  if (!vaultKey) return <form className="auth-form" onSubmit={unlock}><label htmlFor="vault-unlock-secret">Vault Unlock Secret</label><input id="vault-unlock-secret" type="password" value={secret} onChange={(event) => setSecret(event.target.value)} required /><button className="primary-button" type="submit">Unlock Personal Vault</button>{error && <p role="alert">{error}</p>}</form>;
  return <section><h2>Personal Vault accounts</h2>{userRootKey && <SharedVaultCreator userRootKey={userRootKey} />}{accounts.length ? <ul>{accounts.map((account) => <li key={`${account.issuer}:${account.accountName}`}>{account.issuer} — {account.accountName}</li>)}</ul> : <p>No accounts yet.</p>}<QrImportInput onUri={setUri} /><form className="auth-form" onSubmit={(event) => void addAccount(event)}><label htmlFor="account-uri">Authenticator URI</label><input id="account-uri" value={uri} onChange={(event) => setUri(event.target.value)} required /><button className="primary-button" type="submit">Add encrypted account</button></form>{duplicate && <aside><p>A matching account already exists.</p><button type="button" onClick={() => setDuplicate(null)}>Cancel</button><button type="button" onClick={() => void addDuplicateAnyway()}>Add anyway</button></aside>}{error && <p role="alert">{error}</p>}</section>;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Request failed.");
  return response.json() as Promise<T>;
}
function fromBase64(value: string): Uint8Array { const binary = atob(value); return Uint8Array.from(binary, (character) => character.charCodeAt(0)); }
function toBase64(bytes: Uint8Array): string { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
