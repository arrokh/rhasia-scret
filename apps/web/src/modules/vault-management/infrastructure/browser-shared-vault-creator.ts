"use client";

import type { PortableJsonWebKey } from "@rhasia-scret/client-vault-core";
import {
  encryptPayloadWithContext,
  generateSymmetricKey,
  serializeEncryptedEnvelope,
  serializeKeyWrapEnvelope,
  wrapKeyForRecipientWithContext,
} from "@/modules/crypto";

export async function createSharedVaultMaterial(
  ownerPublicKey: PortableJsonWebKey,
  ownerProfileId: string,
  vaultName: string,
  vaultId: string,
): Promise<{
  vaultKey: Uint8Array;
  encryptedName: Uint8Array;
  encryptedOwnerVaultKey: Uint8Array;
  encryptionVersion: 1;
}> {
  if (!vaultName.trim()) throw new Error("A Vault Name is required.");
  const vaultKey = generateSymmetricKey();
  let encryptedName: Uint8Array | undefined;
  let encryptedOwnerVaultKey: Uint8Array | undefined;
  try {
    encryptedName = await encryptSharedVaultName(vaultKey, vaultName, vaultId);
    const wrappedVaultKey = await wrapKeyForRecipientWithContext(vaultKey, ownerPublicKey, {
      purpose: "vault-key-wrap",
      payloadType: "vault-encryption-key",
      vaultId,
      recipientId: ownerProfileId,
      keyVersion: 1,
    });
    try {
      encryptedOwnerVaultKey = serializeKeyWrapEnvelope(wrappedVaultKey);
    } finally {
      wrappedVaultKey.nonce.fill(0);
      wrappedVaultKey.ciphertext.fill(0);
    }
    return { vaultKey, encryptedName, encryptedOwnerVaultKey, encryptionVersion: 1 };
  } catch (error) {
    vaultKey.fill(0);
    encryptedName?.fill(0);
    encryptedOwnerVaultKey?.fill(0);
    throw error;
  }
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
    const encryptedName = await encryptPayloadWithContext(vaultKey, plaintext, {
      purpose: "vault-name",
      payloadType: "vault-name",
      vaultId,
      keyVersion: 1,
    });
    try {
      return serializeEncryptedEnvelope(encryptedName);
    } finally {
      encryptedName.nonce.fill(0);
      encryptedName.ciphertext.fill(0);
    }
  } finally {
    plaintext.fill(0);
  }
}
