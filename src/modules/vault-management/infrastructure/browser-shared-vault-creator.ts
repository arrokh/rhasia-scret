"use client";

import { encryptPayload, generateSymmetricKey, serializeEncryptedEnvelope } from "@/modules/crypto";

export async function createSharedVaultMaterial(userRootKey: Uint8Array, vaultName: string): Promise<{ vaultKey: Uint8Array; encryptedName: Uint8Array; encryptedOwnerVaultKey: Uint8Array; encryptionVersion: 1 }> {
  if (!vaultName.trim()) throw new Error("A Vault Name is required.");
  const vaultKey = generateSymmetricKey();
  return {
    vaultKey,
    encryptedName: await encryptSharedVaultName(vaultKey, vaultName),
    encryptedOwnerVaultKey: serializeEncryptedEnvelope(await encryptPayload(userRootKey, vaultKey)),
    encryptionVersion: 1
  };
}

export async function encryptSharedVaultName(vaultKey: Uint8Array, vaultName: string): Promise<Uint8Array> {
  const normalizedName = vaultName.trim();
  if (!normalizedName) throw new Error("A Vault Name is required.");
  const plaintext = new TextEncoder().encode(normalizedName);
  try {
    return serializeEncryptedEnvelope(await encryptPayload(vaultKey, plaintext));
  } finally {
    plaintext.fill(0);
  }
}
