import { describe, expect, it } from "vitest";
import type {
  AuthenticatedTransport,
  PlatformHttpRequest,
  PlatformHttpResponse,
} from "../src/shared/application/platform-ports";
import { commitUserEncryptionPrivateKeyMigration } from "../src/modules/crypto/application/user-encryption-identity-migration-transport";
import { RetryableEncryptedPayloadMigrationCommitError } from "../src/modules/crypto/application/encrypted-payload-migration";
import type { EncryptedPayloadMigrationCommit } from "../src/modules/crypto/application/encrypted-payload-migration";

const migration: EncryptedPayloadMigrationCommit = {
  expectedEnvelopeVersion: 1,
  replacementEnvelopeVersion: 2,
  expectedCiphertextDigest: "A".repeat(43),
  replacementCiphertextDigest: "B".repeat(43),
  operationId: "B".repeat(43),
  replacementCiphertext: Uint8Array.from([2, 3, 5, 7]),
};

describe("User Encryption Private Key migration transport", () => {
  it("sends only the versioned encrypted replacement and permitted compare-and-swap metadata", async () => {
    let captured: PlatformHttpRequest | undefined;
    const transport = createTransport(204, (request) => (captured = request));

    await expect(commitUserEncryptionPrivateKeyMigration(transport, 1, migration)).resolves.toBe("committed");

    expect(captured).toMatchObject({
      url: "/v1/user-encryption-identity/migration",
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
    });
    const body = captured?.body;
    if (typeof body !== "string") throw new Error("Migration request body is missing.");
    expect(JSON.parse(body)).toEqual({
      expectedEnvelopeVersion: 1,
      replacementEnvelopeVersion: 2,
      userEncryptionKeyVersion: 1,
      expectedCiphertextDigest: migration.expectedCiphertextDigest,
      replacementCiphertextDigest: migration.replacementCiphertextDigest,
      encryptedPrivateKey: "AgMFBw==",
      operationId: migration.operationId,
    });
  });

  it("treats stale authenticated compare-and-swap state as a bounded conflict", async () => {
    await expect(commitUserEncryptionPrivateKeyMigration(createTransport(409), 1, migration)).resolves.toBe("conflict");
  });

  it("marks transient responses and network failures as retryable without exposing details", async () => {
    await expect(commitUserEncryptionPrivateKeyMigration(createTransport(503), 1, migration)).rejects.toBeInstanceOf(
      RetryableEncryptedPayloadMigrationCommitError,
    );
    const transport: AuthenticatedTransport = {
      request: async () => {
        throw new Error("private response body");
      },
    };
    await expect(commitUserEncryptionPrivateKeyMigration(transport, 1, migration)).rejects.toBeInstanceOf(
      RetryableEncryptedPayloadMigrationCommitError,
    );
    const canceled: AuthenticatedTransport = {
      request: async () => {
        throw new DOMException("interrupted", "AbortError");
      },
    };
    await expect(commitUserEncryptionPrivateKeyMigration(canceled, 1, migration)).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect(commitUserEncryptionPrivateKeyMigration(createTransport(400), 1, migration)).rejects.toThrow(
      "User Encryption Private Key migration failed.",
    );
  });
});

function createTransport(status: number, onRequest?: (request: PlatformHttpRequest) => void): AuthenticatedTransport {
  return {
    request: async (request) => {
      onRequest?.(request);
      return createResponse(status);
    },
  };
}

function createResponse(status: number): PlatformHttpResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    json: async <T>() => undefined as T,
    bytes: async () => new Uint8Array(),
    text: async () => "synthetic response body",
  };
}
