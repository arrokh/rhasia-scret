"use client";

import { decryptPayloadWithContext, deserializeEncryptedEnvelope, encryptPayloadWithContext, generateSymmetricKey, serializeEncryptedEnvelope, type CryptoEnvelopeContext } from "./browser-crypto-envelope";

export type EncryptedVaultRotationInput = {
  encryptedName: Uint8Array;
  encryptedAccounts: Uint8Array[];
  vaultId?: string;
  accountIds?: string[];
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
  const nameContext: CryptoEnvelopeContext = { purpose: "vault-name", payloadType: "vault-name", vaultId: input.vaultId, keyVersion: 1 };
  const rotate = async (ciphertext: Uint8Array, context: CryptoEnvelopeContext) => {
    const plaintext = await decryptPayloadWithContext(oldVaultKey, deserializeEncryptedEnvelope(ciphertext), context);
    try {
      return serializeEncryptedEnvelope(await encryptPayloadWithContext(vaultKey, plaintext, context));
    } finally {
      plaintext.fill(0);
    }
  };
  const encryptedName = await rotate(input.encryptedName, nameContext);
  const encryptedAccounts = await Promise.all(input.encryptedAccounts.map((ciphertext, index) => rotate(ciphertext, { purpose: "authenticator-account", payloadType: "totp-configuration", vaultId: input.vaultId, accountId: input.accountIds?.[index], keyVersion: 1 })));
  return { vaultKey, vaultId: input.vaultId, encryptedName, encryptedAccounts };
}
