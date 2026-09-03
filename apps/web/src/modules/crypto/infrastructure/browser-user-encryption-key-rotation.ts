"use client";

import {
  rotateUserEncryptionIdentityWithCrypto,
  type EncryptedUserEncryptionIdentity,
} from "@rhasia-scret/client-vault-core";
import { browserClientCryptoPort } from "./browser-client-crypto-port";

/**
 * Rotates a user's ECDH identity in the browser and re-wraps supplied Vault
 * Encryption Key packages for the fresh public key. No private key or Vault
 * Encryption Key crosses this boundary.
 */
export function rotateUserEncryptionIdentity(
  userRootKey: Uint8Array,
  encryptedPrivateKey: Uint8Array,
  wrappedVaultKeys: Uint8Array[],
): Promise<{ identity: EncryptedUserEncryptionIdentity; wrappedVaultKeys: Uint8Array[] }> {
  return rotateUserEncryptionIdentityWithCrypto(userRootKey, encryptedPrivateKey, wrappedVaultKeys, browserClientCryptoPort);
}
