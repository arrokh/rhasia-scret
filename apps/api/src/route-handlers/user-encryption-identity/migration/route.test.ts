import { describe, expect, it, vi } from "vitest";
import { ApiRequest } from "@api/http/api-request";
import { createMigrateUserEncryptionPrivateKeyHandler } from "@api/route-handlers/user-encryption-identity/migration/route";
import { ApplicationUser } from "@api/modules/identity/domain/application-user";
import type { UserEncryptionPrivateKeyMigration } from "@api/modules/identity/application/user-crypto-profile-repository";

const user = new ApplicationUser("synthetic-user", "rhasia:passwordless", "local-id", "demo@example.test", "ACTIVE");
const ciphertext = bytesToBase64(Uint8Array.from({ length: 64 }, (_, index) => (index === 0 ? 2 : index)));
const requestBody = {
  expectedEnvelopeVersion: 1 as const,
  replacementEnvelopeVersion: 2 as const,
  userEncryptionKeyVersion: 1,
  expectedCiphertextDigest: "A".repeat(43),
  replacementCiphertextDigest: `${"B".repeat(42)}E`,
  encryptedPrivateKey: ciphertext,
  operationId: `${"B".repeat(42)}E`,
};
const request = (body: unknown) =>
  new ApiRequest("https://api.example.test/v1/user-encryption-identity/migration", {
    method: "POST",
    body: JSON.stringify(body),
  });

describe("POST /v1/user-encryption-identity/migration contract", () => {
  it("stores only a validated replacement ciphertext through the profile repository", async () => {
    let persistedEnvelopeVersion: number | undefined;
    const migrateUserEncryptionPrivateKey = vi.fn(
      async (_userId: string, migration: UserEncryptionPrivateKeyMigration) => {
        persistedEnvelopeVersion = migration.encryptedPrivateKey[0];
        return "committed" as const;
      },
    );
    const handler = createMigrateUserEncryptionPrivateKeyHandler({
      authenticate: async () => user,
      cryptoProfiles: { migrateUserEncryptionPrivateKey },
    });

    const response = await handler(request(requestBody));

    expect(response.status).toBe(204);
    expect(migrateUserEncryptionPrivateKey).toHaveBeenCalledWith(
      "synthetic-user",
      expect.objectContaining({
        expectedEnvelopeVersion: 1,
        replacementEnvelopeVersion: 2,
        userEncryptionKeyVersion: 1,
        expectedCiphertextDigest: requestBody.expectedCiphertextDigest,
        replacementCiphertextDigest: requestBody.replacementCiphertextDigest,
        operationId: requestBody.operationId,
        encryptedPrivateKey: expect.any(Uint8Array),
      }),
    );
    expect(persistedEnvelopeVersion).toBe(2);
  });

  it("maps stale compare-and-swap state to a bounded conflict", async () => {
    const handler = createMigrateUserEncryptionPrivateKeyHandler({
      authenticate: async () => user,
      cryptoProfiles: { migrateUserEncryptionPrivateKey: async () => "conflict" },
    });

    const response = await handler(request(requestBody));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "identity_migration_conflict" });
  });

  it("rejects unsupported fields and a replacement that is not a v2 envelope", async () => {
    const migrateUserEncryptionPrivateKey = vi.fn().mockResolvedValue("committed");
    const handler = createMigrateUserEncryptionPrivateKeyHandler({
      authenticate: async () => user,
      cryptoProfiles: { migrateUserEncryptionPrivateKey },
    });

    const unsupportedFieldResponse = await handler(request({ ...requestBody, plaintext: "forbidden" }));
    const legacyTargetResponse = await handler(
      request({ ...requestBody, encryptedPrivateKey: bytesToBase64(new Uint8Array(64).fill(1)) }),
    );
    const unstableOperationResponse = await handler(request({ ...requestBody, operationId: `${"C".repeat(42)}E` }));

    expect(unsupportedFieldResponse.status).toBe(400);
    expect(legacyTargetResponse.status).toBe(400);
    expect(unstableOperationResponse.status).toBe(400);
    expect(migrateUserEncryptionPrivateKey).not.toHaveBeenCalled();
  });
});

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
