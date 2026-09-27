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
  let currentUnlockKey: Uint8Array | undefined;
  let userRootKey: Uint8Array | undefined;
  try {
    currentUnlockKey = await deriveVaultUnlockKey(currentSecret, currentSalt);
    userRootKey = await decryptPayloadWithContext(
      currentUnlockKey,
      deserializeEncryptedEnvelope(currentWrappedUserRootKey),
      { purpose: "user-root-key-wrap", payloadType: "user-root-key", keyVersion: 1 },
    );
    return await wrapUserRootKeyWithVaultUnlockSecret(userRootKey, nextSecret);
  } finally {
    currentUnlockKey?.fill(0);
    userRootKey?.fill(0);
  }
}

export async function wrapUserRootKeyWithVaultUnlockSecret(
  userRootKey: Uint8Array,
  nextSecret: string,
): Promise<RewrappedUserRootKey> {
  const vaultUnlockSalt = randomBytes(16);
  let nextUnlockKey: Uint8Array | undefined;
  try {
    nextUnlockKey = await deriveVaultUnlockKey(nextSecret, vaultUnlockSalt);
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
  } finally {
    nextUnlockKey?.fill(0);
  }
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}
