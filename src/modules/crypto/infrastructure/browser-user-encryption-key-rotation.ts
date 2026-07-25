"use client";

import { createUserEncryptionIdentity, recoverUserEncryptionPrivateKey, type EncryptedUserEncryptionIdentity } from "./browser-user-encryption-identity";
import { deserializeEncryptedEnvelope, deserializeKeyWrapEnvelope, serializeKeyWrapEnvelope, unwrapKeyForRecipient, wrapKeyForRecipient } from "./browser-crypto-envelope";

/**
 * Rotates a user's ECDH identity in the browser and re-wraps supplied Vault
 * Encryption Key packages for the fresh public key. No private key or Vault
 * Encryption Key crosses this boundary.
 */
export async function rotateUserEncryptionIdentity(userRootKey: Uint8Array, encryptedPrivateKey: Uint8Array, wrappedVaultKeys: Uint8Array[]): Promise<{ identity: EncryptedUserEncryptionIdentity; wrappedVaultKeys: Uint8Array[] }> {
  const oldPrivateKey = await recoverUserEncryptionPrivateKey(userRootKey, deserializeEncryptedEnvelope(encryptedPrivateKey));
  const identity = await createUserEncryptionIdentity(userRootKey);
  const wrapped = await Promise.all(wrappedVaultKeys.map(async (packageBytes) => {
    const vaultKey = await unwrapKeyForRecipient(deserializeKeyWrapEnvelope(packageBytes), oldPrivateKey);
    return serializeKeyWrapEnvelope(await wrapKeyForRecipient(vaultKey, identity.publicKey));
  }));
  return { identity, wrappedVaultKeys: wrapped };
}
