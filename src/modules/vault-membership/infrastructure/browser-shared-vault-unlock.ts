"use client";

import { decryptPayload, deserializeEncryptedEnvelope } from "@/modules/crypto";

export async function unlockSharedVault(userRootKey: Uint8Array, encryptedVaultKey: Uint8Array, encryptedName: Uint8Array): Promise<{ vaultKey: Uint8Array; name: string }> {
  const vaultKey = await decryptPayload(userRootKey, deserializeEncryptedEnvelope(encryptedVaultKey));
  try {
    if (vaultKey.length !== 32) throw new Error("Shared Vault Encryption Key is invalid.");
    const plaintextName = await decryptPayload(vaultKey, deserializeEncryptedEnvelope(encryptedName));
    try {
      const name = new TextDecoder("utf-8", { fatal: true }).decode(plaintextName).trim();
      if (!name || name.length > 120) throw new Error("Shared Vault name is invalid.");
      return { vaultKey, name };
    } finally {
      plaintextName.fill(0);
    }
  } catch (error) {
    vaultKey.fill(0);
    throw error;
  }
}
