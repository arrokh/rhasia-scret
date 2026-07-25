"use client";

import { encryptPayload, generateSymmetricKey, serializeEncryptedEnvelope } from "@/modules/crypto";

export async function createSharedVaultMaterial(userRootKey: Uint8Array, vaultName: string): Promise<{ vaultKey: Uint8Array; encryptedName: Uint8Array; encryptedOwnerVaultKey: Uint8Array; encryptionVersion: 1 }> {
  if (!vaultName.trim()) throw new Error("A Vault Name is required.");
  const vaultKey = generateSymmetricKey();
  return {
    vaultKey,
    encryptedName: serializeEncryptedEnvelope(await encryptPayload(vaultKey, new TextEncoder().encode(vaultName))),
    encryptedOwnerVaultKey: serializeEncryptedEnvelope(await encryptPayload(userRootKey, vaultKey)),
    encryptionVersion: 1
  };
}
