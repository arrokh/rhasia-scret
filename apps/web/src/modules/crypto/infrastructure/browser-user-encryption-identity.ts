"use client";

import {
  createUserEncryptionIdentityWithCrypto,
  recoverUserEncryptionPrivateKeyWithCrypto,
  type EncryptedUserEncryptionIdentity,
  type EncryptedEnvelope,
  type PortableJsonWebKey,
} from "@rhasia-scret/client-vault-core";
import { browserClientCryptoPort } from "./browser-client-crypto-port";

export type { EncryptedUserEncryptionIdentity } from "@rhasia-scret/client-vault-core";

export function createUserEncryptionIdentity(userRootKey: Uint8Array): Promise<EncryptedUserEncryptionIdentity> {
  return createUserEncryptionIdentityWithCrypto(userRootKey, browserClientCryptoPort);
}

export function recoverUserEncryptionPrivateKey(
  userRootKey: Uint8Array,
  encryptedPrivateKey: EncryptedEnvelope,
): Promise<PortableJsonWebKey> {
  return recoverUserEncryptionPrivateKeyWithCrypto(userRootKey, encryptedPrivateKey, browserClientCryptoPort);
}
