import type { ClientCryptoPort } from "./crypto-ports";
import type { CryptoEnvelopeContext } from "./encrypted-envelope-types";

export type EncryptedVaultRotationInput = {
  encryptedName: Uint8Array;
  encryptedAccounts: Uint8Array[];
  vaultId?: string;
  accountIds?: string[];
};

export type EncryptedVaultRotationResult = EncryptedVaultRotationInput & {
  vaultKey: Uint8Array;
};

/** Rotates Vault Encryption Key material entirely through the injected client crypto protocol. */
export async function rotateVaultKeyWithCrypto(
  oldVaultKey: Uint8Array,
  input: EncryptedVaultRotationInput,
  crypto: ClientCryptoPort,
): Promise<EncryptedVaultRotationResult> {
  const vaultKey = crypto.generateSymmetricKey();
  const nameContext: CryptoEnvelopeContext = { purpose: "vault-name", payloadType: "vault-name", vaultId: input.vaultId, keyVersion: 1 };
  const rotate = async (ciphertext: Uint8Array, context: CryptoEnvelopeContext): Promise<Uint8Array> => {
    const plaintext = await crypto.decryptPayloadWithContext(oldVaultKey, crypto.deserializeEncryptedEnvelope(ciphertext), context);
    try {
      return crypto.serializeEncryptedEnvelope(await crypto.encryptPayloadWithContext(vaultKey, plaintext, context));
    } finally {
      plaintext.fill(0);
    }
  };

  try {
    const encryptedName = await rotate(input.encryptedName, nameContext);
    const encryptedAccounts = await Promise.all(input.encryptedAccounts.map((ciphertext, index) => rotate(ciphertext, {
      purpose: "authenticator-account",
      payloadType: "totp-configuration",
      vaultId: input.vaultId,
      accountId: input.accountIds?.[index],
      keyVersion: 1,
    })));
    return { vaultKey, vaultId: input.vaultId, encryptedName, encryptedAccounts };
  } catch (error) {
    vaultKey.fill(0);
    throw error;
  }
}
