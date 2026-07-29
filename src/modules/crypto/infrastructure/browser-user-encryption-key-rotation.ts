"use client";

import { createUserEncryptionIdentity, recoverUserEncryptionPrivateKey, type EncryptedUserEncryptionIdentity } from "./browser-user-encryption-identity";
import { deserializeEncryptedEnvelope, deserializeKeyWrapEnvelope, serializeKeyWrapEnvelope, unwrapKeyForRecipientWithContext, wrapKeyForRecipientWithContext } from "./browser-crypto-envelope";

/**
 * Rotates a user's ECDH identity in the browser and re-wraps supplied Vault
 * Encryption Key packages for the fresh public key. No private key or Vault
 * Encryption Key crosses this boundary.
 */
export async function rotateUserEncryptionIdentity(userRootKey: Uint8Array, encryptedPrivateKey: Uint8Array, wrappedVaultKeys: Uint8Array[]): Promise<{ identity: EncryptedUserEncryptionIdentity; wrappedVaultKeys: Uint8Array[] }> {
  const oldPrivateKey = await recoverUserEncryptionPrivateKey(userRootKey, deserializeEncryptedEnvelope(encryptedPrivateKey));
  const identity = await createUserEncryptionIdentity(userRootKey);
  const wrapped = await Promise.all(wrappedVaultKeys.map(async (packageBytes) => {
    const context = { purpose: "vault-key-wrap", payloadType: "vault-encryption-key", keyVersion: 1 } as const;
    const vaultKey = await unwrapKeyForRecipientWithContext(deserializeKeyWrapEnvelope(packageBytes), oldPrivateKey, context);
    try {
      return serializeKeyWrapEnvelope(await wrapKeyForRecipientWithContext(vaultKey, identity.publicKey, context));
    } finally {
      vaultKey.fill(0);
    }
  }));
  return { identity, wrappedVaultKeys: wrapped };
}
