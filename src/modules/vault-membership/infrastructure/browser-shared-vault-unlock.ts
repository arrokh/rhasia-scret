"use client";

import { decryptPayloadWithContext, deserializeEncryptedEnvelope } from "@/modules/crypto";

export async function unlockSharedVault(userRootKey: Uint8Array, encryptedVaultKey: Uint8Array, encryptedName: Uint8Array, vaultId?: string): Promise<{ vaultKey: Uint8Array; name: string }> {
  const context = { purpose: "vault-key-wrap", payloadType: "vault-encryption-key", ...(vaultId ? { vaultId } : {}), keyVersion: 1 } as const;
  const vaultKey = await decryptPayloadWithContext(userRootKey, deserializeEncryptedEnvelope(encryptedVaultKey), context);
  try {
    if (vaultKey.length !== 32) throw new Error("Shared Vault Encryption Key is invalid.");
    const plaintextName = await decryptPayloadWithContext(vaultKey, deserializeEncryptedEnvelope(encryptedName), { purpose: "vault-name", payloadType: "vault-name", ...(vaultId ? { vaultId } : {}), keyVersion: 1 });
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
