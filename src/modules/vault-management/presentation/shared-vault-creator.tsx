"use client";

import { useState, type FormEvent } from "react";
import { createSharedVaultMaterial } from "../infrastructure/browser-shared-vault-creator";
import { useOnlineStatus } from "@/shared/presentation/use-online-status";

export function SharedVaultCreator({ userRootKey }: { userRootKey: Uint8Array }) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState("");
  const online = useOnlineStatus();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!online) { setStatus("Anda sedang luring. Pembuatan Brankas Bersama tidak tersedia hingga Anda tersambung kembali."); return; }
    try {
      const material = await createSharedVaultMaterial(userRootKey, name);
      const response = await fetch("/api/shared-vaults", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ encryptedName: toBase64(material.encryptedName), encryptedOwnerVaultKey: toBase64(material.encryptedOwnerVaultKey), encryptionVersion: material.encryptionVersion }) });
      if (!response.ok) throw new Error("create failed");
      setName("");
      setStatus("Brankas Bersama dibuat. Undang anggota dari pengaturannya.");
    } catch {
      setStatus("Tidak dapat membuat Brankas Bersama.");
    }
  }

  return <form className="auth-form" onSubmit={submit}><label htmlFor="shared-vault-name">Nama Brankas Bersama Baru</label><input id="shared-vault-name" value={name} onChange={(event) => setName(event.target.value)} required disabled={!online} /><button className="primary-button" type="submit" disabled={!online}>Buat Brankas Bersama</button>{!online && <p className="offline-notice" role="status">Luring: perubahan diblokir dan tidak pernah diantrikan.</p>}{status && <p aria-live="polite">{status}</p>}</form>;
}

function toBase64(bytes: Uint8Array): string { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
