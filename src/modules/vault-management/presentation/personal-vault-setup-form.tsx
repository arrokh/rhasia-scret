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
      <label htmlFor="vault-name">Nama Brankas</label>
      <input id="vault-name" name="vaultName" defaultValue="Brankas Pribadi" required />
      <p>Rahasia Pembuka Brankas Anda dibuat di browser ini. Simpan secara luring sebelum melanjutkan.</p>
      <output aria-label="Rahasia Pembuka Brankas">{secret}</output>
      <button type="button" onClick={() => { setSecret(generateVaultUnlockSecret()); setConfirmation(""); }}>
        Buat rahasia lain
      </button>
      <label htmlFor="unlock-secret-confirmation">Masukkan kembali Rahasia Pembuka Brankas</label>
      <input
        id="unlock-secret-confirmation"
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        autoComplete="off"
        required
      />
      <label><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} required /> Saya memahami bahwa ini tidak dapat dipulihkan.</label>
      <button className="primary-button" type="submit" disabled={!acknowledged || status === "saving"}>
        {status === "saving" ? "Mengamankan Brankas…" : "Amankan Brankas Pribadi"}
      </button>
      {status === "error" && <p className="form-status" role="alert">Periksa konfirmasi, lalu coba lagi. Tidak ada rahasia yang dikirim ke server.</p>}
    </form>
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
