"use client";

import { useState, type FormEvent } from "react";
import { generateVaultUnlockSecret, initializePersonalVaultInBrowser } from "@/modules/crypto";

export function PersonalVaultSetupForm() {
  const [secret, setSecret] = useState(generateVaultUnlockSecret);
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmation.trim() !== secret) {
      setStatus("error");
      return;
    }
    setStatus("saving");
    try {
      const form = new FormData(event.currentTarget);
      const material = await initializePersonalVaultInBrowser(secret, String(form.get("vaultName") ?? ""));
      const response = await fetch("/api/personal-vault/initialize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vaultUnlockSalt: toBase64(material.vaultUnlockSalt),
          wrappedUserRootKey: toBase64(material.wrappedUserRootKey),
          encryptedPersonalVaultKey: toBase64(material.encryptedPersonalVaultKey),
          encryptedVaultName: toBase64(material.encryptedVaultName),
          encryptionVersion: material.encryptionVersion
        })
      });
      if (!response.ok) throw new Error("Secure setup could not be completed.");
      window.location.reload();
    } catch {
      setStatus("error");
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label htmlFor="vault-name">Vault Name</label>
      <input id="vault-name" name="vaultName" defaultValue="Personal Vault" required />
      <p>Your Vault Unlock Secret is generated on this browser. Save it offline before continuing.</p>
      <output aria-label="Vault Unlock Secret">{secret}</output>
      <button type="button" onClick={() => { setSecret(generateVaultUnlockSecret()); setConfirmation(""); }}>
        Generate another secret
      </button>
      <label htmlFor="unlock-secret-confirmation">Re-enter the Vault Unlock Secret</label>
      <input
        id="unlock-secret-confirmation"
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        autoComplete="off"
        required
      />
      <label><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} required /> I understand this cannot be recovered.</label>
      <button className="primary-button" type="submit" disabled={!acknowledged || status === "saving"}>
        {status === "saving" ? "Securing Vault…" : "Secure Personal Vault"}
      </button>
      {status === "error" && <p className="form-status" role="alert">Check the confirmation and try again. No secret was sent to the server.</p>}
    </form>
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
