"use client";

import { useState } from "react";
import { createPasskeyCredential } from "../infrastructure/browser-passkey-prf";
import { createPasskeyRecoveryPackage } from "../infrastructure/browser-passkey-recovery-package";

export function PasskeyRecoveryEnrollment({ userRootKey }: { userRootKey: Uint8Array }) {
  const [status, setStatus] = useState("");
  async function enroll() {
    try {
      setStatus("Creating passkey recovery…");
      const options = await fetchJson<PublicKeyCredentialCreationOptionsJSON>("/api/passkey-recovery/registration/options");
      const credential = await createPasskeyCredential(options);
      const encryptedRecoveryPackage = toBase64(await createPasskeyRecoveryPackage(userRootKey, credential.prfOutput, credential.prfSalt));
      const response = await fetch("/api/passkey-recovery/registration/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ response: credential.registrationResponse, encryptedRecoveryPackage }) });
      if (!response.ok) throw new Error("Passkey recovery enrollment failed.");
      setStatus("Passkey recovery is enabled on this device.");
    } catch { setStatus("Unable to enable passkey recovery. This browser must support WebAuthn PRF."); }
  }
  return <section className="passkey-recovery"><p>Optional passkey recovery protects an encrypted recovery package; the service never receives a usable vault key.</p><button className="primary-button" type="button" onClick={() => void enroll()}>Enable passkey recovery</button>{status && <p aria-live="polite">{status}</p>}</section>;
}
async function fetchJson<T>(url: string): Promise<T> { const response = await fetch(url, { method: "POST", cache: "no-store" }); if (!response.ok) throw new Error("request failed"); return response.json() as Promise<T>; }
function toBase64(bytes: Uint8Array): string { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
