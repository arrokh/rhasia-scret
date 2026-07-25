"use client";

import { encryptPayload, generateSymmetricKey, serializeEncryptedEnvelope } from "./browser-crypto-envelope";
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
  return {
    vaultUnlockSalt,
    wrappedUserRootKey: serializeEncryptedEnvelope(await encryptPayload(vaultUnlockKey, userRootKey)),
    encryptedPersonalVaultKey: serializeEncryptedEnvelope(await encryptPayload(userRootKey, personalVaultKey)),
    encryptedVaultName: serializeEncryptedEnvelope(await encryptPayload(personalVaultKey, new TextEncoder().encode(vaultName))),
    encryptionVersion: ENCRYPTION_VERSION
  };
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}
