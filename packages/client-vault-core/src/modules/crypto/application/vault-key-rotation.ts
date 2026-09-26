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

/** Rotates Vault Encryption Key material entirely through the injected client crypto protocol. */
export async function rotateVaultKeyWithCrypto(
  oldVaultKey: Uint8Array,
  input: EncryptedVaultRotationInput,
  crypto: ClientCryptoPort,
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
  const rotate = async (ciphertext: Uint8Array, context: CryptoEnvelopeContext): Promise<Uint8Array> => {
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
    encryptedName = await rotate(input.encryptedName, nameContext);
    for (const ciphertext of input.encryptedAccounts) {
      encryptedAccounts.push(
        await rotate(ciphertext, {
          purpose: "authenticator-account",
          payloadType: "totp-configuration",
          vaultId: input.vaultId,
          keyVersion: 1,
        }),
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
