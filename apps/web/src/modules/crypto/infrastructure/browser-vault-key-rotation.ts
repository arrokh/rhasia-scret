"use client";

import {
  rotateVaultKeyWithCrypto,
  type EncryptedVaultRotationInput,
  type EncryptedVaultRotationResult,
} from "@rhasia-scret/client-vault-core";
import { browserClientCryptoPort } from "./browser-client-crypto-port";

export type { EncryptedVaultRotationInput, EncryptedVaultRotationResult } from "@rhasia-scret/client-vault-core";

/**
 * Rotates Vault Encryption Key material entirely in the browser. Callers must
 * persist only the returned ciphertext and distribute the new key package to
 * each currently authorized member.
 */
export function rotateVaultKey(
  oldVaultKey: Uint8Array,
  input: EncryptedVaultRotationInput,
): Promise<EncryptedVaultRotationResult> {
  return rotateVaultKeyWithCrypto(oldVaultKey, input, browserClientCryptoPort);
}
