"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { generateVaultUnlockSecret, initializePersonalVaultInBrowser } from "@/modules/crypto";

export function PersonalVaultSetupForm() {
  const router = useRouter();
  const generatedSecret = useRef<string | null>(null);
  const [secret, setSecret] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "validation_error" | "setup_error">("idle");

  useEffect(() => {
    generatedSecret.current ??= generateVaultUnlockSecret();
    setSecret(generatedSecret.current);
  }, []);

  function regenerateSecret() {
    const nextSecret = generateVaultUnlockSecret();
    generatedSecret.current = nextSecret;
    setSecret(nextSecret);
    setConfirmation("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!secret || confirmation.trim() !== secret) {
      setStatus("validation_error");
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
      router.refresh();
    } catch {
      setStatus("setup_error");
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label htmlFor="vault-name">Nama Brankas</label>
      <input id="vault-name" name="vaultName" defaultValue="Brankas Pribadi" required />
      <p>Passphrase Brankas Anda dibuat di browser ini. Simpan secara luring sebelum melanjutkan.</p>
      <output aria-label="Passphrase Brankas">{secret || "Membuat passphrase…"}</output>
      <button className="secondary-button" type="button" disabled={!secret} onClick={regenerateSecret}>
        Buat rahasia lain
      </button>
      <label htmlFor="unlock-secret-confirmation">Masukkan kembali Passphrase Brankas</label>
      <input
        id="unlock-secret-confirmation"
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        autoComplete="off"
        required
      />
      <label className="checkbox-label"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} required /> <span>Saya memahami bahwa tanpa kunci akses pemulihan, Passphrase Brankas ini tidak dapat dipulihkan.</span></label>
      <button className="primary-button" type="submit" disabled={!secret || status === "saving"} aria-busy={status === "saving"}>
        {status === "saving" ? "Mengamankan Brankas…" : "Amankan Brankas Pribadi"}
      </button>
      {status === "saving" && <p className="form-status" role="status">Kunci sedang dibuat di browser ini. Proses ini dapat memerlukan beberapa detik.</p>}
      {status === "validation_error" && <p className="form-status" role="alert">Konfirmasi Passphrase Brankas tidak cocok.</p>}
      {status === "setup_error" && <p className="form-status" role="alert">Brankas tidak dapat diamankan. Coba lagi. Tidak ada rahasia yang dikirim ke server.</p>}
    </form>
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
