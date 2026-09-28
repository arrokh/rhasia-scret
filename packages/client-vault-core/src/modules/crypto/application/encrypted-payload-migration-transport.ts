import { bytesToBase64 } from "../../../shared/application/base64";
import type { AuthenticatedTransport, CancellationPort } from "../../../shared/application/platform-ports";
import {
  RetryableEncryptedPayloadMigrationCommitError,
  type EncryptedPayloadMigrationCommit,
  type EncryptedPayloadMigrationCommitResult,
} from "./encrypted-payload-migration";

export type EncryptedPayloadMigrationRouteMetadata = Readonly<Record<string, string | number>>;
/** Posts one prepared ciphertext-only migration operation; the owning engine retries transient uncertainty once. */
export async function commitEncryptedPayloadMigrationTransport(
  transport: AuthenticatedTransport,
  url: string,
  metadata: EncryptedPayloadMigrationRouteMetadata,
  migration: EncryptedPayloadMigrationCommit,
  signal?: CancellationPort,
): Promise<EncryptedPayloadMigrationCommitResult> {
  let response;
  try {
    response = await transport.request({
      url,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...metadata,
        expectedEnvelopeVersion: migration.expectedEnvelopeVersion,
        replacementEnvelopeVersion: migration.replacementEnvelopeVersion,
        expectedCiphertextDigest: migration.expectedCiphertextDigest,
        replacementCiphertextDigest: migration.replacementCiphertextDigest,
        replacementCiphertext: bytesToBase64(migration.replacementCiphertext),
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
  if (response.status === 408 || response.status >= 500) throw new RetryableEncryptedPayloadMigrationCommitError();
  throw new Error("Encrypted payload migration request failed.");
}
