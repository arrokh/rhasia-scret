"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { passkeyRecoverySalt, recoverUserRootKeyFromPasskeyPackage } from "../infrastructure/browser-passkey-recovery-package";
import { authenticatePasskey, evaluatePasskeyPrf } from "../infrastructure/browser-passkey-prf";
import { wrapUserRootKeyWithVaultUnlockSecret } from "../infrastructure/browser-vault-unlock-secret-change";
import { generateVaultUnlockSecret } from "./generate-vault-unlock-secret";

type RecoveryPackageResponse = { encryptedRecoveryPackage: string };
type Status = "idle" | "recovering" | "validation_error" | "recovery_error" | "success";

export function PasskeyRecoveryReset() {
  const generatedSecret = useRef<string | null>(null);
  const [secret, setSecret] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [status, setStatus] = useState<Status>("idle");

  useEffect(() => {
    generatedSecret.current ??= generateVaultUnlockSecret();
    setSecret(generatedSecret.current);
  }, []);

  function regenerateSecret() {
    const nextSecret = generateVaultUnlockSecret();
    generatedSecret.current = nextSecret;
    setSecret(nextSecret);
    setConfirmation("");
    setStatus("idle");
  }

  async function reset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!secret || confirmation.trim() !== secret || !acknowledged) {
      setStatus("validation_error");
      return;
    }

    setStatus("recovering");
    let prfOutput: Uint8Array | undefined;
    let userRootKey: Uint8Array | undefined;
    try {
      const options = await fetchJson<PublicKeyCredentialRequestOptionsJSON>(
        "/api/passkey-recovery/authentication/options",
        { method: "POST" }
      );
      const credential = requiredRecoveryCredential(options);
      const assertionResponse = await authenticatePasskey(options);
      const recovery = await fetchJson<RecoveryPackageResponse>(
        "/api/passkey-recovery/authentication/verify",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ response: assertionResponse })
        }
      );
      const packageBytes = fromBase64(recovery.encryptedRecoveryPackage);
      prfOutput = await evaluatePasskeyPrf(
        fromBase64Url(credential.id),
        credential.rpId,
        passkeyRecoverySalt(packageBytes)
      );
      ({ userRootKey } = await recoverUserRootKeyFromPasskeyPackage(prfOutput, packageBytes));
      const rewrapped = await wrapUserRootKeyWithVaultUnlockSecret(userRootKey, secret);
      await fetchEmpty("/api/user-crypto-profile/rewrap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vaultUnlockSalt: toBase64(rewrapped.vaultUnlockSalt),
          wrappedUserRootKey: toBase64(rewrapped.wrappedUserRootKey),
          encryptionVersion: 1
        })
      });
      setStatus("success");
    } catch {
      setStatus("recovery_error");
    } finally {
      prfOutput?.fill(0);
      userRootKey?.fill(0);
    }
  }

  return (
    <form className="auth-form vault-recovery-form" onSubmit={reset}>
      <p className="vault-flow-title">Atur ulang Passphrase Brankas</p>
      <p className="vault-flow-copy">Gunakan kunci akses pemulihan yang telah Anda daftarkan. Pemulihan dan pembungkusan ulang kunci dilakukan hanya di browser ini.</p>
      <label htmlFor="recovery-new-secret">Passphrase Brankas baru</label>
      <output id="recovery-new-secret" aria-label="Passphrase Brankas baru">{secret || "Membuat passphrase…"}</output>
      <button className="secondary-button" type="button" disabled={!secret || status === "recovering" || status === "success"} onClick={regenerateSecret}>Buat passphrase lain</button>
      <label htmlFor="recovery-secret-confirmation">Masukkan kembali passphrase baru</label>
      <input
        id="recovery-secret-confirmation"
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        autoComplete="off"
        disabled={status === "recovering" || status === "success"}
        required
      />
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          disabled={status === "recovering" || status === "success"}
          required
        /> <span>Saya telah menyimpan passphrase baru secara luring.</span>
      </label>
      <button className="primary-button" type="submit" disabled={!secret || status === "recovering" || status === "success"} aria-busy={status === "recovering"}>
        {status === "recovering" ? "Memverifikasi kunci akses…" : "Atur ulang passphrase"}
      </button>
      {status !== "recovering" && <Link className="secondary-link" href="/vaults">Kembali ke pembukaan brankas</Link>}
      {status === "validation_error" && <p className="form-status" role="alert">Konfirmasi harus cocok dan passphrase baru harus disimpan secara luring.</p>}
      {status === "recovery_error" && <p className="form-status" role="alert">Passphrase tidak dapat diatur ulang. Pastikan kunci akses pemulihan tersedia dan coba lagi.</p>}
      {status === "success" && <p className="form-status" role="status">Passphrase berhasil diatur ulang. Simpan passphrase baru di atas, lalu gunakan untuk membuka brankas.</p>}
    </form>
  );
}

function requiredRecoveryCredential(options: PublicKeyCredentialRequestOptionsJSON): { id: string; rpId: string } {
  const id = options.allowCredentials?.[0]?.id;
  if (!id || !options.rpId) throw new Error("Passkey recovery options are incomplete.");
  return { id, rpId: options.rpId };
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  if (!response.ok) throw new Error("Recovery request failed.");
  return response.json() as Promise<T>;
}

async function fetchEmpty(url: string, init: RequestInit): Promise<void> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error("Recovery request failed.");
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return fromBase64(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
