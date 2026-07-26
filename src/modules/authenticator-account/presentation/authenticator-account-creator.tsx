"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { parseTotpUri } from "@/modules/otp-runtime";
import { useOnlineStatus } from "@/shared/presentation/use-online-status";
import { encryptAccountConfiguration, isDuplicateAccount, type DecryptedAuthenticatorAccount } from "../infrastructure/browser-account-payload";
import { loadUnlockedVaultWorkspace, type UnlockedVaultWorkspace } from "../infrastructure/browser-vault-workspace";
import { QrImportInput } from "./qr-import-input";

export function AuthenticatorAccountCreator({ personalVaultId }: { personalVaultId: string }) {
  const router = useRouter();
  const online = useOnlineStatus();
  const [workspace, setWorkspace] = useState<UnlockedVaultWorkspace | null>(null);
  const [secret, setSecret] = useState("");
  const [selectedVaultId, setSelectedVaultId] = useState("");
  const [uri, setUri] = useState("");
  const [duplicate, setDuplicate] = useState<DecryptedAuthenticatorAccount | null>(null);
  const [status, setStatus] = useState<"idle" | "unlocking" | "saving" | "error">("idle");
  const [message, setMessage] = useState("");

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("unlocking");
    try {
      const unlocked = await loadUnlockedVaultWorkspace(secret, personalVaultId);
      const writableVaults = unlocked.vaults.filter((vault) => vault.type === "PERSONAL" || vault.role === "OWNER");
      setWorkspace(unlocked);
      setSelectedVaultId(writableVaults[0]?.id ?? "");
      setSecret("");
      setStatus("idle");
      setMessage(unlocked.unavailableSharedVaults > 0
        ? `${unlocked.unavailableSharedVaults} Brankas Bersama tidak dapat dibuka dan tidak tersedia sebagai tujuan.`
        : "");
    } catch {
      setStatus("error");
      setMessage("Tidak dapat membuka brankas Anda.");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !online) return;
    try {
      const candidate = parseTotpUri(uri);
      const existing = workspace.accounts.filter((account) => account.vaultId === selectedVaultId);
      if (isDuplicateAccount(candidate, existing)) {
        setDuplicate(candidate);
        return;
      }
      await save(candidate);
    } catch (reason) {
      setStatus("error");
      setMessage(reason instanceof Error ? reason.message : "Tidak dapat menambahkan akun ini.");
    }
  }

  async function saveDuplicate() {
    if (!duplicate) return;
    try {
      await save(duplicate);
    } catch (reason) {
      setStatus("error");
      setMessage(reason instanceof Error ? reason.message : "Tidak dapat menambahkan akun ini.");
    }
  }

  async function save(candidate: DecryptedAuthenticatorAccount) {
    if (!workspace) return;
    const vault = workspace.vaults.find((entry) => entry.id === selectedVaultId);
    if (!vault || (vault.type === "SHARED" && vault.role !== "OWNER")) throw new Error("Brankas tujuan tidak dapat diubah.");
    setStatus("saving");
    const encryptedPayload = await encryptAccountConfiguration(vault.key, candidate);
    const endpoint = vault.type === "PERSONAL"
      ? `/api/vaults/${vault.id}/accounts`
      : `/api/shared-vaults/${vault.id}/accounts`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ encryptedPayload: toBase64(encryptedPayload), encryptionVersion: 1 })
    });
    if (!response.ok) throw new Error("Tidak dapat menyimpan akun terenkripsi.");
    setDuplicate(null);
    router.push("/vaults");
    router.refresh();
  }

  if (!workspace) {
    return (
      <form className="auth-form vault-unlock-form" onSubmit={unlock}>
        <p className="vault-flow-copy">Buka brankas untuk memilih tujuan akun. Passphrase Brankas tetap di browser ini.</p>
        <label htmlFor="account-vault-unlock-secret">Passphrase Brankas</label>
        <input id="account-vault-unlock-secret" type="password" value={secret} onChange={(event) => setSecret(event.target.value)} required />
        <button className="primary-button" type="submit" disabled={status === "unlocking"} aria-busy={status === "unlocking"}>
          {status === "unlocking" ? "Membuka brankas…" : "Lanjutkan"}
        </button>
        {message && <p className="form-status" role="alert">{message}</p>}
      </form>
    );
  }

  const writableVaults = workspace.vaults.filter((vault) => vault.type === "PERSONAL" || vault.role === "OWNER");
  return (
    <>
      {!online && <p className="offline-notice" role="status">Luring: akun baru tidak dapat disimpan.</p>}
      <QrImportInput onUri={setUri} />
      <form className="auth-form add-account-form" onSubmit={submit}>
        <label htmlFor="account-target-vault">Simpan ke brankas</label>
        <select id="account-target-vault" value={selectedVaultId} onChange={(event) => setSelectedVaultId(event.target.value)} required>
          {writableVaults.map((vault) => <option key={vault.id} value={vault.id}>{vault.name}</option>)}
        </select>
        <label htmlFor="account-uri">URI autentikator</label>
        <input id="account-uri" value={uri} onChange={(event) => setUri(event.target.value)} placeholder="otpauth://totp/…" autoComplete="off" required disabled={!online} />
        <div className="form-actions">
          <Link className="secondary-link" href="/vaults">Batal</Link>
          <button className="primary-button" type="submit" disabled={!online || status === "saving"} aria-busy={status === "saving"}>
            {status === "saving" ? "Menyimpan…" : "Simpan akun"}
          </button>
        </div>
      </form>
      {duplicate && <aside className="duplicate-account"><p>Akun yang sama sudah ada di brankas ini.</p><button className="secondary-button" type="button" onClick={() => setDuplicate(null)}>Batal</button><button className="primary-button" type="button" onClick={() => void saveDuplicate()} disabled={!online}>Tetap tambahkan</button></aside>}
      {message && <p className="form-status" role="alert">{message}</p>}
    </>
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
