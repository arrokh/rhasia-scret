"use client";

import {
  parseDecryptedAccountPayload,
  rotateVaultKeyWithCrypto,
  type CancellationPort,
  type EncryptedVaultRotationInput,
  type EncryptedVaultRotationResult,
  type VaultKeyRotationPayloadValidator,
} from "@rhasia-scret/client-vault-core";
import { browserClientCryptoPort } from "./browser-client-crypto-port";

const rotationPayloadValidator: VaultKeyRotationPayloadValidator = {
  validateVaultName(plaintext) {
    let name: string;
    try {
      name = new TextDecoder("utf-8", { fatal: true }).decode(plaintext).trim();
    } catch {
      throw new Error("Vault name is invalid.");
    }
    if (!name || name.length > 120) throw new Error("Vault name is invalid.");
  },
  validateAuthenticatorAccount(plaintext) {
    const account = parseDecryptedAccountPayload(plaintext);
    account.secret.fill(0);
  },
};

export type { EncryptedVaultRotationInput, EncryptedVaultRotationResult } from "@rhasia-scret/client-vault-core";

/**
 * Rotates Vault Encryption Key material entirely in the browser. Callers must
 * persist only the returned ciphertext and distribute the new key package to
 * each currently authorized member.
 */
export function rotateVaultKey(
  oldVaultKey: Uint8Array,
  input: EncryptedVaultRotationInput,
  signal?: CancellationPort,
): Promise<EncryptedVaultRotationResult> {
  return rotateVaultKeyWithCrypto(oldVaultKey, input, browserClientCryptoPort, rotationPayloadValidator, signal);
}
