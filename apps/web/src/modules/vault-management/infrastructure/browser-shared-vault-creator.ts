"use client";

import { encryptPayloadWithContext, generateSymmetricKey, serializeEncryptedEnvelope } from "@/modules/crypto";

export async function createSharedVaultMaterial(
  userRootKey: Uint8Array,
  vaultName: string,
  vaultId?: string,
): Promise<{
  vaultKey: Uint8Array;
  encryptedName: Uint8Array;
  encryptedOwnerVaultKey: Uint8Array;
  encryptionVersion: 1;
}> {
  if (!vaultName.trim()) throw new Error("A Vault Name is required.");
  const vaultKey = generateSymmetricKey();
  return {
    vaultKey,
    encryptedName: await encryptSharedVaultName(vaultKey, vaultName, vaultId),
    encryptedOwnerVaultKey: serializeEncryptedEnvelope(
      await encryptPayloadWithContext(userRootKey, vaultKey, {
        purpose: "vault-key-wrap",
        payloadType: "vault-encryption-key",
        vaultId,
        keyVersion: 1,
      }),
    ),
    encryptionVersion: 1,
  };
}

export async function encryptSharedVaultName(
  vaultKey: Uint8Array,
  vaultName: string,
  vaultId?: string,
): Promise<Uint8Array> {
  const normalizedName = vaultName.trim();
  if (!normalizedName) throw new Error("A Vault Name is required.");
  const plaintext = new TextEncoder().encode(normalizedName);
  try {
    return serializeEncryptedEnvelope(
      await encryptPayloadWithContext(vaultKey, plaintext, {
        purpose: "vault-name",
        payloadType: "vault-name",
        vaultId,
        keyVersion: 1,
      }),
    );
  } finally {
    plaintext.fill(0);
  }
}
