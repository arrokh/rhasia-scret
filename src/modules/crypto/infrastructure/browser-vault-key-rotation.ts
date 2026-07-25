"use client";

import { decryptPayload, deserializeEncryptedEnvelope, encryptPayload, generateSymmetricKey, serializeEncryptedEnvelope } from "./browser-crypto-envelope";

export type EncryptedVaultRotationInput = {
  encryptedName: Uint8Array;
  encryptedAccounts: Uint8Array[];
};

export type EncryptedVaultRotationResult = EncryptedVaultRotationInput & {
  vaultKey: Uint8Array;
};

/**
 * Rotates Vault Encryption Key material entirely in the browser. Callers must
 * persist only the returned ciphertext and distribute the new key package to
 * each currently authorized member.
 */
export async function rotateVaultKey(oldVaultKey: Uint8Array, input: EncryptedVaultRotationInput): Promise<EncryptedVaultRotationResult> {
  const vaultKey = generateSymmetricKey();
  const rotate = async (ciphertext: Uint8Array) => serializeEncryptedEnvelope(
    await encryptPayload(vaultKey, await decryptPayload(oldVaultKey, deserializeEncryptedEnvelope(ciphertext)))
  );
  return { vaultKey, encryptedName: await rotate(input.encryptedName), encryptedAccounts: await Promise.all(input.encryptedAccounts.map(rotate)) };
}
