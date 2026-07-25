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
    if (!online) { setStatus("You are offline. Creating a Shared Vault is unavailable until you reconnect."); return; }
    try {
      const material = await createSharedVaultMaterial(userRootKey, name);
      const response = await fetch("/api/shared-vaults", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ encryptedName: toBase64(material.encryptedName), encryptedOwnerVaultKey: toBase64(material.encryptedOwnerVaultKey), encryptionVersion: material.encryptionVersion }) });
      if (!response.ok) throw new Error("create failed");
      setName("");
      setStatus("Shared Vault created. Invite members from its settings.");
    } catch {
      setStatus("Unable to create the Shared Vault.");
    }
  }

  return <form className="auth-form" onSubmit={submit}><label htmlFor="shared-vault-name">New Shared Vault Name</label><input id="shared-vault-name" value={name} onChange={(event) => setName(event.target.value)} required disabled={!online} /><button className="primary-button" type="submit" disabled={!online}>Create Shared Vault</button>{!online && <p className="offline-notice" role="status">Offline: changes are blocked and never queued.</p>}{status && <p aria-live="polite">{status}</p>}</form>;
}

function toBase64(bytes: Uint8Array): string { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
