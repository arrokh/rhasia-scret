import { bytesToBase64Url } from "../../../shared/application/base64";
import type { ClientCryptoPort, PortableJsonWebKey, Sha256DigestPort } from "../../crypto/application/crypto-ports";
import {
  EncryptedPayloadMigrationError,
  RetryableEncryptedPayloadMigrationCommitError,
  type EncryptedPayloadMigrationCommit,
  type EncryptedPayloadMigrationStore,
} from "../../crypto/application/encrypted-payload-migration";
import type { CryptoEnvelopeContext, KeyWrapEnvelope } from "../../crypto/application/encrypted-envelope-types";

export type SharedVaultKeyWrapMigrationContext = Readonly<{
  vaultId: string;
  recipientId: string;
  keyVersion: number;
}>;

export type SharedVaultKeyWrapMigrationResult =
  { status: "already-current" } | { status: "migrated"; encryptedVaultKey: Uint8Array };

/** Explicitly upgrades a legacy member key wrap without sending a Vault Encryption Key to persistence. */
export async function migrateLegacySharedVaultKeyWrapWithCrypto(
  userRootKey: Uint8Array,
  legacyCiphertext: Uint8Array,
  privateKey: PortableJsonWebKey,
  publicKey: PortableJsonWebKey,
  context: SharedVaultKeyWrapMigrationContext,
  crypto: ClientCryptoPort,
  digest: Sha256DigestPort,
  store: EncryptedPayloadMigrationStore,
): Promise<SharedVaultKeyWrapMigrationResult> {
  let keyWrapEnvelope: KeyWrapEnvelope | undefined;
  let payloadEnvelope: ReturnType<ClientCryptoPort["deserializeEncryptedEnvelope"]> | undefined;
  let vaultKey: Uint8Array | undefined;
  let replacementEnvelope: KeyWrapEnvelope | undefined;
  let replacementCiphertext: Uint8Array | undefined;
  let expectedDigest: Uint8Array | undefined;
  let replacementDigest: Uint8Array | undefined;
  let returnedCiphertext: Uint8Array | undefined;
  let sourceVersion: 1 | 2;

  try {
    try {
      if (legacyCiphertext[0] === 0x7b) {
        keyWrapEnvelope = crypto.deserializeKeyWrapEnvelope(legacyCiphertext);
        sourceVersion = keyWrapEnvelope.version;
      } else {
        payloadEnvelope = crypto.deserializeEncryptedEnvelope(legacyCiphertext);
        sourceVersion = payloadEnvelope.version;
      }
    } catch (error) {
      throw new EncryptedPayloadMigrationError("envelope-invalid", error);
    }
    if (sourceVersion === 2) return { status: "already-current" };

    try {
      if (keyWrapEnvelope) {
        vaultKey = await crypto.unwrapKeyForRecipient(keyWrapEnvelope, privateKey);
      } else if (payloadEnvelope) {
        vaultKey = await crypto.decryptPayload(userRootKey, payloadEnvelope);
      }
    } catch (error) {
      throw new EncryptedPayloadMigrationError("decryption-failed", error);
    }
    if (!vaultKey || vaultKey.length !== 32) throw new EncryptedPayloadMigrationError("payload-invalid");
    if (!publicKeyMatchesPrivateKey(privateKey, publicKey)) throw new EncryptedPayloadMigrationError("payload-invalid");

    const cryptoContext: CryptoEnvelopeContext = {
      purpose: "vault-key-wrap",
      payloadType: "vault-encryption-key",
      vaultId: context.vaultId,
      recipientId: context.recipientId,
      keyVersion: context.keyVersion,
    };
    try {
      replacementEnvelope = await crypto.wrapKeyForRecipientWithContext(vaultKey, publicKey, cryptoContext);
      replacementCiphertext = crypto.serializeKeyWrapEnvelope(replacementEnvelope);
      expectedDigest = await digest.digestSha256(legacyCiphertext);
      replacementDigest = await digest.digestSha256(replacementCiphertext);
      if (expectedDigest.length !== 32 || replacementDigest.length !== 32)
        throw new Error("Crypto provider returned an invalid SHA-256 digest.");
    } catch (error) {
      throw new EncryptedPayloadMigrationError("reencryption-failed", error);
    }

    const replacementFingerprint = bytesToBase64Url(replacementDigest);
    const request: EncryptedPayloadMigrationCommit = {
      expectedEnvelopeVersion: 1,
      replacementEnvelopeVersion: 2,
      expectedCiphertextDigest: bytesToBase64Url(expectedDigest),
      replacementCiphertextDigest: replacementFingerprint,
      replacementCiphertext,
      operationId: replacementFingerprint,
    };
    const result = await commitWithRetry(store, request);
    if (result === "conflict") throw new EncryptedPayloadMigrationError("persistence-conflict");
    if (result !== "committed" && result !== "already-committed")
      throw new EncryptedPayloadMigrationError("persistence-failed");
    returnedCiphertext = replacementCiphertext.slice();
    return { status: "migrated", encryptedVaultKey: returnedCiphertext };
  } finally {
    keyWrapEnvelope?.nonce.fill(0);
    keyWrapEnvelope?.ciphertext.fill(0);
    payloadEnvelope?.nonce.fill(0);
    payloadEnvelope?.ciphertext.fill(0);
    vaultKey?.fill(0);
    replacementEnvelope?.nonce.fill(0);
    replacementEnvelope?.ciphertext.fill(0);
    replacementCiphertext?.fill(0);
    expectedDigest?.fill(0);
    replacementDigest?.fill(0);
  }
}

async function commitWithRetry(
  store: EncryptedPayloadMigrationStore,
  request: EncryptedPayloadMigrationCommit,
): Promise<"committed" | "already-committed" | "conflict"> {
  try {
    return await store.commitEncryptedPayloadMigration(request);
  } catch (error) {
    if (isCancellationError(error)) throw error;
    if (!(error instanceof RetryableEncryptedPayloadMigrationCommitError)) {
      throw new EncryptedPayloadMigrationError("persistence-failed", error);
    }
  }
  try {
    return await store.commitEncryptedPayloadMigration(request);
  } catch (error) {
    if (isCancellationError(error)) throw error;
    throw new EncryptedPayloadMigrationError("persistence-failed", error);
  }
}

function isCancellationError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function publicKeyMatchesPrivateKey(privateKey: PortableJsonWebKey, publicKey: PortableJsonWebKey): boolean {
  return ["kty", "crv", "x", "y"].every(
    (field) => typeof privateKey[field] === "string" && privateKey[field] === publicKey[field],
  );
}
