import type { ClientCryptoPort } from "./crypto-ports";
import type { EncryptedUserEncryptionIdentity } from "./user-encryption-identity";
import { createUserEncryptionIdentityWithCrypto, recoverUserEncryptionPrivateKeyWithCrypto } from "./user-encryption-identity";

/** Re-wraps supplied Vault Encryption Key packages for a fresh user ECDH identity. */
export async function rotateUserEncryptionIdentityWithCrypto(
  userRootKey: Uint8Array,
  encryptedPrivateKey: Uint8Array,
  wrappedVaultKeys: Uint8Array[],
  crypto: ClientCryptoPort,
): Promise<{ identity: EncryptedUserEncryptionIdentity; wrappedVaultKeys: Uint8Array[] }> {
  const oldPrivateKey = await recoverUserEncryptionPrivateKeyWithCrypto(
    userRootKey,
    crypto.deserializeEncryptedEnvelope(encryptedPrivateKey),
    crypto,
  );
  const identity = await createUserEncryptionIdentityWithCrypto(userRootKey, crypto);
  const context = { purpose: "vault-key-wrap", payloadType: "vault-encryption-key", keyVersion: 1 } as const;
  const wrapped = await Promise.all(wrappedVaultKeys.map(async (packageBytes) => {
    const vaultKey = await crypto.unwrapKeyForRecipientWithContext(
      crypto.deserializeKeyWrapEnvelope(packageBytes),
      oldPrivateKey,
      context,
    );
    try {
      return crypto.serializeKeyWrapEnvelope(await crypto.wrapKeyForRecipientWithContext(vaultKey, identity.publicKey, context));
    } finally {
      vaultKey.fill(0);
    }
  }));
  return { identity, wrappedVaultKeys: wrapped };
}
