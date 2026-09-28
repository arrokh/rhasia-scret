import { bytesToBase64 } from "../../../shared/application/base64";
import type { AuthenticatedTransport, CancellationPort } from "../../../shared/application/platform-ports";
import {
  RetryableEncryptedPayloadMigrationCommitError,
  type EncryptedPayloadMigrationCommit,
  type EncryptedPayloadMigrationCommitResult,
} from "./encrypted-payload-migration";

/** Persists the opaque replacement through the authenticated identity-migration operation. */
export async function commitUserEncryptionPrivateKeyMigration(
  transport: AuthenticatedTransport,
  userEncryptionKeyVersion: number,
  migration: EncryptedPayloadMigrationCommit,
  signal?: CancellationPort,
): Promise<EncryptedPayloadMigrationCommitResult> {
  let response;
  try {
    response = await transport.request({
      url: "/v1/user-encryption-identity/migration",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedEnvelopeVersion: migration.expectedEnvelopeVersion,
        replacementEnvelopeVersion: migration.replacementEnvelopeVersion,
        userEncryptionKeyVersion,
        expectedCiphertextDigest: migration.expectedCiphertextDigest,
        replacementCiphertextDigest: migration.replacementCiphertextDigest,
        encryptedPrivateKey: bytesToBase64(migration.replacementCiphertext),
        operationId: migration.operationId,
      }),
      cache: "no-store",
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new RetryableEncryptedPayloadMigrationCommitError();
  }
  if (response.status === 204) return "committed";
  if (response.status === 409) return "conflict";
  if (response.status === 408 || response.status >= 500) {
    throw new RetryableEncryptedPayloadMigrationCommitError();
  }
  throw new Error("User Encryption Private Key migration failed.");
}
