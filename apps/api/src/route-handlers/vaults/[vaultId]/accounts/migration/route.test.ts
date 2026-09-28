import { describe, expect, it, vi } from "vitest";
import { ApiRequest } from "@api/http/api-request";
import { ApplicationUser } from "@api/modules/identity/domain/application-user";
import { createPersonalAccountPayloadMigrationHandler } from "@api/route-handlers/vaults/[vaultId]/accounts/migration/route";
import type { EncryptedPayloadMigration } from "@api/shared/application/encrypted-payload-migration";

const user = new ApplicationUser("synthetic-user", "rhasia:passwordless", "local-id", "demo@example.test", "ACTIVE");
const ciphertext = base64(Uint8Array.from({ length: 64 }, (_, index) => (index === 0 ? 2 : index)));
const body = {
  accountId: "synthetic-account",
  expectedRevision: 3,
  expectedKeyVersion: 1,
  expectedEnvelopeVersion: 1,
  replacementEnvelopeVersion: 2,
  expectedCiphertextDigest: "A".repeat(43),
  replacementCiphertextDigest: `${"B".repeat(42)}E`,
  replacementCiphertext: ciphertext,
  operationId: `${"B".repeat(42)}E`,
};
const request = (value: unknown) =>
  new ApiRequest("https://api.example.test/v1/vaults/vault-synthetic/accounts/migration", {
    method: "POST",
    body: JSON.stringify(value),
  });
const context = { params: Promise.resolve({ vaultId: "vault-synthetic" }) };

describe("POST /v1/vaults/:vaultId/accounts/migration", () => {
  it("commits only the validated ciphertext replacement and clears route bytes", async () => {
    let captured: EncryptedPayloadMigration | undefined;
    let replacementCopy: Uint8Array | undefined;
    const migratePayload = vi.fn(
      async (
        _ownerId: string,
        _vaultId: string,
        _accountId: string,
        _revision: number,
        _keyVersion: number,
        migration: EncryptedPayloadMigration,
      ) => {
        captured = migration;
        replacementCopy = migration.replacementCiphertext.slice();
        return "committed" as const;
      },
    );
    const handler = createPersonalAccountPayloadMigrationHandler({
      authenticate: async () => user,
      accounts: { migratePayload },
    });

    const response = await handler(request(body), context);

    expect(response.status).toBe(204);
    expect(migratePayload).toHaveBeenCalledWith(
      "synthetic-user",
      "vault-synthetic",
      "synthetic-account",
      3,
      1,
      expect.objectContaining({
        expectedEnvelopeVersion: 1,
        replacementEnvelopeVersion: 2,
        expectedCiphertextDigest: body.expectedCiphertextDigest,
        replacementCiphertextDigest: body.replacementCiphertextDigest,
        operationId: body.operationId,
        replacementCiphertext: expect.any(Uint8Array),
      }),
    );
    expect(replacementCopy?.[0]).toBe(2);
    expect(captured?.replacementCiphertext.every((byte) => byte === 0)).toBe(true);
  });

  it("does not expose missing accounts and rejects unsupported request fields", async () => {
    const migratePayload = vi.fn().mockResolvedValue("conflict");
    const handler = createPersonalAccountPayloadMigrationHandler({
      authenticate: async () => user,
      accounts: { migratePayload },
    });

    const conflict = await handler(request(body), context);
    const invalid = await handler(request({ ...body, plaintext: "forbidden" }), context);

    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toEqual({ error: "account_migration_conflict" });
    expect(invalid.status).toBe(400);
    expect(migratePayload).toHaveBeenCalledTimes(1);
  });
});

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
