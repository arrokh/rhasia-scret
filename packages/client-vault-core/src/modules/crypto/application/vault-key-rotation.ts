import type { CancellationPort } from "../../../shared/application/platform-ports";
import type { ClientCryptoPort } from "./crypto-ports";
import type { CryptoEnvelopeContext } from "./encrypted-envelope-types";

export type EncryptedVaultRotationInput = {
  encryptedName: Uint8Array;
  encryptedAccounts: Uint8Array[];
  vaultId?: string;
};

export type EncryptedVaultRotationResult = EncryptedVaultRotationInput & {
  vaultKey: Uint8Array;
};

/** Validates decrypted payloads against their owning domain contracts before rotation re-encrypts them. */
export type VaultKeyRotationPayloadValidator = Readonly<{
  validateVaultName(plaintext: Uint8Array): void;
  validateAuthenticatorAccount(plaintext: Uint8Array): void;
}>;

/** Rotates Vault Encryption Key material entirely through the injected client crypto protocol. */
export async function rotateVaultKeyWithCrypto(
  oldVaultKey: Uint8Array,
  input: EncryptedVaultRotationInput,
  crypto: ClientCryptoPort,
  payloadValidator: VaultKeyRotationPayloadValidator,
  signal?: CancellationPort,
): Promise<EncryptedVaultRotationResult> {
  assertNotCancelled(signal);
  const vaultKey = crypto.generateSymmetricKey();
  let encryptedName: Uint8Array | undefined;
  const encryptedAccounts: Uint8Array[] = [];
  const nameContext: CryptoEnvelopeContext = {
    purpose: "vault-name",
    payloadType: "vault-name",
    vaultId: input.vaultId,
    keyVersion: 1,
  };
  const rotate = async (
    ciphertext: Uint8Array,
    context: CryptoEnvelopeContext,
    validatePlaintext: (plaintext: Uint8Array) => void,
  ): Promise<Uint8Array> => {
    assertNotCancelled(signal);
    const sourceEnvelope = crypto.deserializeEncryptedEnvelope(ciphertext);
    let plaintext: Uint8Array;
    try {
      plaintext =
        sourceEnvelope.version === 1
          ? await crypto.decryptPayload(oldVaultKey, sourceEnvelope)
          : await crypto.decryptPayloadWithContext(oldVaultKey, sourceEnvelope, context);
    } finally {
      sourceEnvelope.nonce.fill(0);
      sourceEnvelope.ciphertext.fill(0);
    }
    try {
      assertNotCancelled(signal);
      validatePlaintext(plaintext);
      assertNotCancelled(signal);
      const envelope = await crypto.encryptPayloadWithContext(vaultKey, plaintext, context);
      try {
        assertNotCancelled(signal);
        return crypto.serializeEncryptedEnvelope(envelope);
      } finally {
        envelope.nonce.fill(0);
        envelope.ciphertext.fill(0);
      }
    } finally {
      plaintext.fill(0);
    }
  };

  try {
    encryptedName = await rotate(input.encryptedName, nameContext, (plaintext) =>
      payloadValidator.validateVaultName(plaintext),
    );
    for (const ciphertext of input.encryptedAccounts) {
      encryptedAccounts.push(
        await rotate(
          ciphertext,
          {
            purpose: "authenticator-account",
            payloadType: "totp-configuration",
            vaultId: input.vaultId,
            keyVersion: 1,
          },
          (plaintext) => payloadValidator.validateAuthenticatorAccount(plaintext),
        ),
      );
    }
    assertNotCancelled(signal);
    return { vaultKey, vaultId: input.vaultId, encryptedName, encryptedAccounts };
  } catch (error) {
    vaultKey.fill(0);
    encryptedName?.fill(0);
    for (const account of encryptedAccounts) account.fill(0);
    throw error;
  }
}

function assertNotCancelled(signal?: CancellationPort): void {
  if (!signal?.aborted) return;
  const error = new Error("Vault Encryption Key rotation was cancelled.");
  error.name = "AbortError";
  throw error;
}
