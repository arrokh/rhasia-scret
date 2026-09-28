import type { ClientCryptoPort, PortableJsonWebKey } from "../../crypto/application/crypto-ports";

export type SharedVaultUnlockContext = Readonly<{
  vaultId: string;
  recipientId: string;
  keyVersion: number;
  userEncryptionPrivateKey?: PortableJsonWebKey;
}>;

export async function unlockSharedVaultWithCrypto(
  crypto: ClientCryptoPort,
  userRootKey: Uint8Array,
  encryptedVaultKey: Uint8Array,
  encryptedName: Uint8Array,
  context: SharedVaultUnlockContext,
): Promise<{ vaultKey: Uint8Array; name: string }> {
  const vaultKey = await unwrapSharedVaultKeyWithCrypto(crypto, userRootKey, encryptedVaultKey, context);
  let nameEnvelope: ReturnType<ClientCryptoPort["deserializeEncryptedEnvelope"]> | undefined;
  try {
    nameEnvelope = crypto.deserializeEncryptedEnvelope(encryptedName);
    const plaintextName = await crypto.decryptPayloadWithContext(vaultKey, nameEnvelope, {
      purpose: "vault-name",
      payloadType: "vault-name",
      ...(context.vaultId ? { vaultId: context.vaultId } : {}),
      keyVersion: 1,
    });
    try {
      const name = new TextDecoder("utf-8", { fatal: true }).decode(plaintextName).trim();
      if (!name || name.length > 120) throw new Error("Shared Vault name is invalid.");
      return { vaultKey, name };
    } finally {
      plaintextName.fill(0);
    }
  } catch (error) {
    vaultKey.fill(0);
    throw error;
  } finally {
    nameEnvelope?.nonce.fill(0);
    nameEnvelope?.ciphertext.fill(0);
  }
}

/** Opens only context-bound Shared Vault key packages; legacy formats require explicit migration first. */
export async function unwrapSharedVaultKeyWithCrypto(
  crypto: ClientCryptoPort,
  userRootKey: Uint8Array,
  encryptedVaultKey: Uint8Array,
  context: SharedVaultUnlockContext,
): Promise<Uint8Array> {
  const { vaultId, recipientId, keyVersion, userEncryptionPrivateKey } = context;
  let vaultKey: Uint8Array;
  if (encryptedVaultKey[0] === 0x7b) {
    if (!userEncryptionPrivateKey) throw new Error("User Encryption Key Pair is unavailable.");
    const keyEnvelope = crypto.deserializeKeyWrapEnvelope(encryptedVaultKey);
    try {
      vaultKey = await crypto.unwrapKeyForRecipientWithContext(keyEnvelope, userEncryptionPrivateKey, {
        purpose: "vault-key-wrap",
        payloadType: "vault-encryption-key",
        vaultId,
        recipientId,
        keyVersion,
      });
    } finally {
      keyEnvelope.nonce.fill(0);
      keyEnvelope.ciphertext.fill(0);
    }
  } else {
    const keyEnvelope = crypto.deserializeEncryptedEnvelope(encryptedVaultKey);
    try {
      vaultKey = await crypto.decryptPayloadWithContext(userRootKey, keyEnvelope, {
        purpose: "vault-key-wrap",
        payloadType: "vault-encryption-key",
        vaultId,
        keyVersion,
      });
    } finally {
      keyEnvelope.nonce.fill(0);
      keyEnvelope.ciphertext.fill(0);
    }
  }
  if (vaultKey.length === 32) return vaultKey;
  vaultKey.fill(0);
  throw new Error("Shared Vault Encryption Key is invalid.");
}
