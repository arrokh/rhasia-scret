"use client";

import { decryptPayload, deserializeEncryptedEnvelope, encryptPayload, serializeEncryptedEnvelope } from "./browser-crypto-envelope";
import { deriveVaultUnlockKey } from "./browser-vault-unlock-key";

export type RewrappedUserRootKey = {
  vaultUnlockSalt: Uint8Array;
  wrappedUserRootKey: Uint8Array;
};

export async function changeVaultUnlockSecret(
  currentSecret: string,
  nextSecret: string,
  currentSalt: Uint8Array,
  currentWrappedUserRootKey: Uint8Array
): Promise<RewrappedUserRootKey> {
  const currentUnlockKey = await deriveVaultUnlockKey(currentSecret, currentSalt);
  const userRootKey = await decryptPayload(currentUnlockKey, deserializeEncryptedEnvelope(currentWrappedUserRootKey));
  const vaultUnlockSalt = randomBytes(16);
  const nextUnlockKey = await deriveVaultUnlockKey(nextSecret, vaultUnlockSalt);
  return {
    vaultUnlockSalt,
    wrappedUserRootKey: serializeEncryptedEnvelope(await encryptPayload(nextUnlockKey, userRootKey))
  };
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}
