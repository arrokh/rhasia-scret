import { describe, expect, it, vi } from "vitest";
import { ApiRequest } from "@api/http/api-request";
import { ApplicationUser } from "@api/modules/identity/domain/application-user";
import { createSharedAccountPayloadMigrationHandler } from "@api/route-handlers/shared-vaults/[vaultId]/accounts/migration/route";
import type { EncryptedPayloadMigration } from "@api/shared/application/encrypted-payload-migration";

const user = new ApplicationUser("synthetic-user", "rhasia:passwordless", "local-id", "demo@example.test", "ACTIVE");
const ciphertext = base64(Uint8Array.from({ length: 64 }, (_, index) => (index === 0 ? 2 : index)));
const body = {
  accountId: "synthetic-account",
  expectedRevision: 3,
  expectedKeyVersion: 2,
  expectedEnvelopeVersion: 1,
  replacementEnvelopeVersion: 2,
  expectedCiphertextDigest: "A".repeat(43),
  replacementCiphertextDigest: `${"B".repeat(42)}E`,
  replacementCiphertext: ciphertext,
  operationId: `${"B".repeat(42)}E`,
};
const request = (value: unknown) =>
  new ApiRequest("https://api.example.test/v1/shared-vaults/vault-synthetic/accounts/migration", {
    method: "POST",
    body: JSON.stringify(value),
  });
const context = { params: Promise.resolve({ vaultId: "vault-synthetic" }) };

describe("POST /v1/shared-vaults/:vaultId/accounts/migration", () => {
  it("authenticates as an account mutation and commits only ciphertext", async () => {
    let captured: EncryptedPayloadMigration | undefined;
    let replacementCopy: Uint8Array | undefined;
    const migratePayload = vi.fn(
      async (
        _actorId: string,
        _vaultId: string,
        _accountId: string,
        _revision: number,
        _keyVersion: number,
        migration: EncryptedPayloadMigration,
      ) => {
        captured = migration;
        replacementCopy = migration.replacementCiphertext.slice();
        return "already-committed" as const;
      },
    );
    const authenticate = vi.fn(async () => user);
    const handler = createSharedAccountPayloadMigrationHandler({ authenticate, accounts: { migratePayload } });
    const apiRequest = request(body);

    const response = await handler(apiRequest, context);

    expect(response.status).toBe(204);
    expect(authenticate).toHaveBeenCalledWith(apiRequest, "account_mutation", "fresh-provider-user");
    expect(migratePayload).toHaveBeenCalledWith(
      "synthetic-user",
      "vault-synthetic",
      "synthetic-account",
      3,
      2,
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
});

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
