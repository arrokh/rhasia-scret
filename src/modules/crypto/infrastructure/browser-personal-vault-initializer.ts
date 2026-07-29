"use client";

import { encryptPayloadWithContext, generateSymmetricKey, serializeEncryptedEnvelope } from "./browser-crypto-envelope";
import { deriveVaultUnlockKey } from "./browser-vault-unlock-key";

const ENCRYPTION_VERSION = 1;

type EncryptedBlob = Uint8Array;

export type PersonalVaultInitializationMaterial = {
  vaultUnlockSalt: Uint8Array;
  wrappedUserRootKey: EncryptedBlob;
  encryptedPersonalVaultKey: EncryptedBlob;
  encryptedVaultName: EncryptedBlob;
  encryptionVersion: number;
};

export async function initializePersonalVaultInBrowser(
  vaultUnlockSecret: string,
  vaultName: string
): Promise<PersonalVaultInitializationMaterial> {
  if (!vaultName.trim()) throw new Error("A Vault Name is required.");

  const vaultUnlockSalt = randomBytes(16);
  const vaultUnlockKey = await deriveVaultUnlockKey(vaultUnlockSecret, vaultUnlockSalt);
  const userRootKey = generateSymmetricKey();
  const personalVaultKey = generateSymmetricKey();
  const nameBytes = new TextEncoder().encode(vaultName);
  try {
    return {
      vaultUnlockSalt,
      wrappedUserRootKey: serializeEncryptedEnvelope(await encryptPayloadWithContext(vaultUnlockKey, userRootKey, { purpose: "user-root-key-wrap", payloadType: "user-root-key", keyVersion: 1 })),
      encryptedPersonalVaultKey: serializeEncryptedEnvelope(await encryptPayloadWithContext(userRootKey, personalVaultKey, { purpose: "vault-key-wrap", payloadType: "vault-encryption-key", keyVersion: 1 })),
      encryptedVaultName: serializeEncryptedEnvelope(await encryptPayloadWithContext(personalVaultKey, nameBytes, { purpose: "vault-name", payloadType: "vault-name", keyVersion: 1 })),
      encryptionVersion: ENCRYPTION_VERSION
    };
  } finally {
    nameBytes.fill(0);
    vaultUnlockKey.fill(0);
    userRootKey.fill(0);
    personalVaultKey.fill(0);
  }
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}
