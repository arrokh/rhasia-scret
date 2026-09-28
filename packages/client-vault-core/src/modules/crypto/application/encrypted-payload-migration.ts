import { bytesToBase64Url } from "../../../shared/application/base64";
import type { ClientCryptoPort, Sha256DigestPort } from "./crypto-ports";
import type { CryptoEnvelopeContext, EncryptedEnvelope } from "./encrypted-envelope-types";

export type EncryptedPayloadMigrationCommitResult = "committed" | "already-committed" | "conflict";

export class RetryableEncryptedPayloadMigrationCommitError extends Error {
  public constructor() {
    super("Encrypted payload migration commit may be retried.");
    this.name = "RetryableEncryptedPayloadMigrationCommitError";
  }
}

export type EncryptedPayloadCryptoPort = Pick<
  ClientCryptoPort,
  "deserializeEncryptedEnvelope" | "decryptPayload" | "encryptPayloadWithContext" | "serializeEncryptedEnvelope"
>;

export type EncryptedPayloadMigrationCommit = {
  expectedEnvelopeVersion: 1;
  replacementEnvelopeVersion: 2;
  expectedCiphertextDigest: string;
  replacementCiphertextDigest: string;
  replacementCiphertext: Uint8Array;
  /** The replacement ciphertext digest is the stable operation ID and idempotent destination fingerprint. */
  operationId: string;
};

/**
 * Implementations atomically compare the expected digest and recognize an already-installed replacement.
 * Throw RetryableEncryptedPayloadMigrationCommitError only for transient uncertainty; the engine replays that exact request once.
 */
export interface EncryptedPayloadMigrationStore {
  commitEncryptedPayloadMigration(
    request: EncryptedPayloadMigrationCommit,
  ): Promise<EncryptedPayloadMigrationCommitResult>;
}

export type LegacyEncryptedPayloadMigrationSpec<T> = {
  context: CryptoEnvelopeContext;
  validatePlaintext(plaintext: Uint8Array): T | Promise<T>;
  clearValidatedPayload(payload: T): void;
};

export type EncryptedPayloadMigrationFailureStage =
  | "envelope-invalid"
  | "source-not-legacy"
  | "decryption-failed"
  | "payload-invalid"
  | "reencryption-failed"
  | "persistence-conflict"
  | "persistence-failed";

export class EncryptedPayloadMigrationError extends Error {
  public constructor(
    public readonly stage: EncryptedPayloadMigrationFailureStage,
    cause?: unknown,
  ) {
    super("Encrypted payload migration failed.", { cause });
    this.name = "EncryptedPayloadMigrationError";
  }
}

/** Migrates one explicitly identified v1 payload and commits only its replacement ciphertext. */
export async function migrateLegacyEncryptedPayloadWithCrypto<T>(
  key: Uint8Array,
  legacyCiphertext: Uint8Array,
  spec: LegacyEncryptedPayloadMigrationSpec<T>,
  crypto: EncryptedPayloadCryptoPort,
  digest: Sha256DigestPort,
  store: EncryptedPayloadMigrationStore,
): Promise<T> {
  let sourceEnvelope: ReturnType<ClientCryptoPort["deserializeEncryptedEnvelope"]> | undefined;
  let plaintext: Uint8Array | undefined;
  let validatedPayload: T | undefined;
  let replacementEnvelope: EncryptedEnvelope | undefined;
  let replacementCiphertext: Uint8Array | undefined;
  let expectedCiphertextDigest: Uint8Array | undefined;
  let replacementCiphertextDigest: Uint8Array | undefined;
  let operationIdBytes: Uint8Array | undefined;
  let committed = false;

  try {
    try {
      sourceEnvelope = crypto.deserializeEncryptedEnvelope(legacyCiphertext);
    } catch (error) {
      throw new EncryptedPayloadMigrationError("envelope-invalid", error);
    }
    if (sourceEnvelope.version !== 1) throw new EncryptedPayloadMigrationError("source-not-legacy");

    try {
      plaintext = await crypto.decryptPayload(key, sourceEnvelope);
    } catch (error) {
      throw new EncryptedPayloadMigrationError("decryption-failed", error);
    }

    try {
      validatedPayload = await spec.validatePlaintext(plaintext);
    } catch (error) {
      throw new EncryptedPayloadMigrationError("payload-invalid", error);
    }

    try {
      replacementEnvelope = await crypto.encryptPayloadWithContext(key, plaintext, spec.context);
      replacementCiphertext = crypto.serializeEncryptedEnvelope(replacementEnvelope);
      expectedCiphertextDigest = await digest.digestSha256(legacyCiphertext);
      replacementCiphertextDigest = await digest.digestSha256(replacementCiphertext);
      if (expectedCiphertextDigest.length !== 32 || replacementCiphertextDigest.length !== 32) {
        throw new Error("Crypto provider returned an invalid SHA-256 digest.");
      }
      operationIdBytes = replacementCiphertextDigest.slice();
    } catch (error) {
      throw new EncryptedPayloadMigrationError("reencryption-failed", error);
    }

    const commitRequest: EncryptedPayloadMigrationCommit = {
      expectedEnvelopeVersion: 1,
      replacementEnvelopeVersion: 2,
      expectedCiphertextDigest: bytesToBase64Url(expectedCiphertextDigest),
      replacementCiphertextDigest: bytesToBase64Url(replacementCiphertextDigest),
      replacementCiphertext,
      operationId: bytesToBase64Url(operationIdBytes),
    };
    const result = await commitWithRetry(store, commitRequest);
    if (result === "conflict") throw new EncryptedPayloadMigrationError("persistence-conflict");
    if (result !== "committed" && result !== "already-committed")
      throw new EncryptedPayloadMigrationError("persistence-failed");

    committed = true;
    return validatedPayload;
  } finally {
    plaintext?.fill(0);
    sourceEnvelope?.nonce.fill(0);
    sourceEnvelope?.ciphertext.fill(0);
    replacementEnvelope?.nonce.fill(0);
    replacementEnvelope?.ciphertext.fill(0);
    replacementCiphertext?.fill(0);
    expectedCiphertextDigest?.fill(0);
    replacementCiphertextDigest?.fill(0);
    operationIdBytes?.fill(0);
    if (!committed && validatedPayload !== undefined) spec.clearValidatedPayload(validatedPayload);
  }
}

async function commitWithRetry(
  store: EncryptedPayloadMigrationStore,
  request: EncryptedPayloadMigrationCommit,
): Promise<EncryptedPayloadMigrationCommitResult> {
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
