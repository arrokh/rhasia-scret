"use client";

import { useState } from "react";
import { createPasskeyCredential } from "../infrastructure/browser-passkey-prf";
import { createPasskeyRecoveryPackage } from "../infrastructure/browser-passkey-recovery-package";

export function PasskeyRecoveryEnrollment({ userRootKey }: { userRootKey: Uint8Array }) {
  const [status, setStatus] = useState("");
  async function enroll() {
    try {
      setStatus("Membuat pemulihan kunci akses…");
      const options = await fetchJson<PublicKeyCredentialCreationOptionsJSON>("/api/passkey-recovery/registration/options");
      const credential = await createPasskeyCredential(options);
      const encryptedRecoveryPackage = toBase64(await createPasskeyRecoveryPackage(userRootKey, credential.prfOutput, credential.prfSalt));
      const response = await fetch("/api/passkey-recovery/registration/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ response: credential.registrationResponse, encryptedRecoveryPackage }) });
      if (!response.ok) throw new Error("Pendaftaran pemulihan kunci akses gagal.");
      setStatus("Pemulihan kunci akses diaktifkan di perangkat ini.");
    } catch { setStatus("Tidak dapat mengaktifkan pemulihan kunci akses. Browser ini harus mendukung PRF WebAuthn."); }
  }
  return <section className="passkey-recovery"><p>Pemulihan kunci akses opsional melindungi paket pemulihan terenkripsi; layanan tidak pernah menerima kunci brankas yang dapat digunakan.</p><button className="primary-button" type="button" onClick={() => void enroll()}>Aktifkan pemulihan kunci akses</button>{status && <p aria-live="polite">{status}</p>}</section>;
}
async function fetchJson<T>(url: string): Promise<T> { const response = await fetch(url, { method: "POST", cache: "no-store" }); if (!response.ok) throw new Error("request failed"); return response.json() as Promise<T>; }
function toBase64(bytes: Uint8Array): string { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
