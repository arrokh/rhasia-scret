"use client";

import { decryptPayload, deserializeEncryptedEnvelope } from "@/modules/crypto";

export async function unlockSharedVault(userRootKey: Uint8Array, encryptedVaultKey: Uint8Array, encryptedName: Uint8Array): Promise<{ vaultKey: Uint8Array; name: string }> {
  const vaultKey = await decryptPayload(userRootKey, deserializeEncryptedEnvelope(encryptedVaultKey));
  if (vaultKey.length !== 32) throw new Error("Shared Vault Encryption Key is invalid.");
  const name = new TextDecoder().decode(await decryptPayload(vaultKey, deserializeEncryptedEnvelope(encryptedName)));
  return { vaultKey, name };
}
