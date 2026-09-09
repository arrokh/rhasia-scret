"use client";

import {
  decryptPayloadWithContext,
  deserializeEncryptedEnvelope,
  encryptPayloadWithContext,
  serializeEncryptedEnvelope,
} from "./browser-crypto-envelope";
import { deriveVaultUnlockKey } from "./browser-vault-unlock-key";

export type RewrappedUserRootKey = {
  vaultUnlockSalt: Uint8Array;
  wrappedUserRootKey: Uint8Array;
};

export async function changeVaultUnlockSecret(
  currentSecret: string,
  nextSecret: string,
  currentSalt: Uint8Array,
  currentWrappedUserRootKey: Uint8Array,
): Promise<RewrappedUserRootKey> {
  const currentUnlockKey = await deriveVaultUnlockKey(currentSecret, currentSalt);
  const userRootKey = await decryptPayloadWithContext(
    currentUnlockKey,
    deserializeEncryptedEnvelope(currentWrappedUserRootKey),
    { purpose: "user-root-key-wrap", payloadType: "user-root-key", keyVersion: 1 },
  );
  return wrapUserRootKeyWithVaultUnlockSecret(userRootKey, nextSecret);
}

export async function wrapUserRootKeyWithVaultUnlockSecret(
  userRootKey: Uint8Array,
  nextSecret: string,
): Promise<RewrappedUserRootKey> {
  const vaultUnlockSalt = randomBytes(16);
  const nextUnlockKey = await deriveVaultUnlockKey(nextSecret, vaultUnlockSalt);
  return {
    vaultUnlockSalt,
    wrappedUserRootKey: serializeEncryptedEnvelope(
      await encryptPayloadWithContext(nextUnlockKey, userRootKey, {
        purpose: "user-root-key-wrap",
        payloadType: "user-root-key",
        keyVersion: 1,
      }),
    ),
  };
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}
