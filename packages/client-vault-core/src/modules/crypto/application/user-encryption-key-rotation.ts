import type { CancellationPort } from "../../../shared/application/platform-ports";
import type { ClientCryptoPort } from "./crypto-ports";
import type { EncryptedUserEncryptionIdentity } from "./user-encryption-identity";
import {
  createUserEncryptionIdentityWithCrypto,
  recoverUserEncryptionPrivateKeyWithCrypto,
} from "./user-encryption-identity";

export type UserEncryptionKeyWrap = {
  vaultId: string;
  recipientId: string;
  keyVersion: number;
  encryptedVaultKey: Uint8Array;
};

/** Re-wraps Vault Encryption Key packages for a fresh identity using each membership's authenticated context. */
export async function rotateUserEncryptionIdentityWithCrypto(
  userRootKey: Uint8Array,
  encryptedPrivateKey: Uint8Array,
  wrappedVaultKeys: UserEncryptionKeyWrap[],
  crypto: ClientCryptoPort,
  signal?: CancellationPort,
): Promise<{ identity: EncryptedUserEncryptionIdentity; wrappedVaultKeys: UserEncryptionKeyWrap[] }> {
  assertNotCancelled(signal);
  const encryptedIdentity = crypto.deserializeEncryptedEnvelope(encryptedPrivateKey);
  let oldPrivateKey: Awaited<ReturnType<typeof recoverUserEncryptionPrivateKeyWithCrypto>> | undefined;
  try {
    oldPrivateKey = await recoverUserEncryptionPrivateKeyWithCrypto(userRootKey, encryptedIdentity, crypto);
  } finally {
    encryptedIdentity.nonce.fill(0);
    encryptedIdentity.ciphertext.fill(0);
  }
  let identity: EncryptedUserEncryptionIdentity | undefined;
  const rewrapped: UserEncryptionKeyWrap[] = [];
  try {
    identity = await createUserEncryptionIdentityWithCrypto(userRootKey, crypto);
    for (const keyWrap of wrappedVaultKeys) {
      assertNotCancelled(signal);
      const context = vaultKeyWrapContext(keyWrap);
      let vaultKey: Uint8Array | undefined;
      if (keyWrap.encryptedVaultKey[0] === 0x7b) {
        const keyEnvelope = crypto.deserializeKeyWrapEnvelope(keyWrap.encryptedVaultKey);
        try {
          vaultKey = await crypto.unwrapKeyForRecipientWithContext(keyEnvelope, oldPrivateKey, context);
        } finally {
          keyEnvelope.nonce.fill(0);
          keyEnvelope.ciphertext.fill(0);
        }
      } else {
        const legacyEnvelope = crypto.deserializeEncryptedEnvelope(keyWrap.encryptedVaultKey);
        try {
          vaultKey =
            legacyEnvelope.version === 1
              ? await crypto.decryptPayload(userRootKey, legacyEnvelope)
              : await crypto.decryptPayloadWithContext(userRootKey, legacyEnvelope, legacyVaultKeyWrapContext(keyWrap));
        } finally {
          legacyEnvelope.nonce.fill(0);
          legacyEnvelope.ciphertext.fill(0);
        }
      }
      try {
        assertNotCancelled(signal);
        const nextEnvelope = await crypto.wrapKeyForRecipientWithContext(vaultKey, identity.publicKey, context);
        try {
          assertNotCancelled(signal);
          rewrapped.push({
            ...keyWrap,
            encryptedVaultKey: crypto.serializeKeyWrapEnvelope(nextEnvelope),
          });
        } finally {
          nextEnvelope.nonce.fill(0);
          nextEnvelope.ciphertext.fill(0);
        }
      } finally {
        vaultKey.fill(0);
      }
    }
    assertNotCancelled(signal);
    return { identity, wrappedVaultKeys: rewrapped };
  } catch (error) {
    for (const keyWrap of rewrapped) keyWrap.encryptedVaultKey.fill(0);
    identity?.encryptedPrivateKey.nonce.fill(0);
    identity?.encryptedPrivateKey.ciphertext.fill(0);
    throw error;
  } finally {
    if (oldPrivateKey) {
      Reflect.set(oldPrivateKey, "x", "");
      Reflect.set(oldPrivateKey, "y", "");
      Reflect.set(oldPrivateKey, "d", "");
    }
  }
}

function assertNotCancelled(signal?: CancellationPort): void {
  if (!signal?.aborted) return;
  const error = new Error("User Encryption Key Pair rotation was cancelled.");
  error.name = "AbortError";
  throw error;
}

function legacyVaultKeyWrapContext(keyWrap: UserEncryptionKeyWrap) {
  return {
    purpose: "vault-key-wrap",
    payloadType: "vault-encryption-key",
    vaultId: keyWrap.vaultId,
    keyVersion: keyWrap.keyVersion,
  } as const;
}

function vaultKeyWrapContext(keyWrap: UserEncryptionKeyWrap) {
  return {
    purpose: "vault-key-wrap",
    payloadType: "vault-encryption-key",
    vaultId: keyWrap.vaultId,
    recipientId: keyWrap.recipientId,
    keyVersion: keyWrap.keyVersion,
  } as const;
}
