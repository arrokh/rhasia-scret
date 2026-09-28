import { describe, expect, it, vi } from "vitest";
import { ApiRequest } from "@api/http/api-request";
import { createPersonalVaultNameMigrationHandler } from "@api/route-handlers/personal-vault/name/migration/route";
import { ApplicationUser } from "@api/modules/identity/domain/application-user";
import type { EncryptedPayloadMigration } from "@api/shared/application/encrypted-payload-migration";

const user = new ApplicationUser("synthetic-user", "rhasia:passwordless", "local-id", "demo@example.test", "ACTIVE");
const encryptedName = base64(Uint8Array.from({ length: 64 }, (_, index) => (index === 0 ? 2 : index)));
const body = {
  vaultId: "personal-synthetic-vault",
  expectedKeyVersion: 1,
  expectedEnvelopeVersion: 1,
  replacementEnvelopeVersion: 2,
  expectedCiphertextDigest: "A".repeat(43),
  replacementCiphertextDigest: `${"B".repeat(42)}E`,
  replacementCiphertext: encryptedName,
  operationId: `${"B".repeat(42)}E`,
};
const request = (value: unknown) =>
  new ApiRequest("https://api.example.test/v1/personal-vault/name/migration", {
    method: "POST",
    body: JSON.stringify(value),
  });

describe("POST /v1/personal-vault/name/migration contract", () => {
  it("commits only the ciphertext replacement and clears the route buffer", async () => {
    let captured: EncryptedPayloadMigration | undefined;
    let replacementCopy: Uint8Array | undefined;
    const migrateName = vi.fn(
      async (_ownerId: string, _vaultId: string, _keyVersion: number, migration: EncryptedPayloadMigration) => {
        captured = migration;
        replacementCopy = migration.replacementCiphertext.slice();
        return "committed" as const;
      },
    );
    const handler = createPersonalVaultNameMigrationHandler({
      authenticate: async () => user,
      personalVaults: { migrateName },
    });

    const response = await handler(request(body));

    expect(response.status).toBe(204);
    expect(migrateName).toHaveBeenCalledWith(
      "synthetic-user",
      "personal-synthetic-vault",
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

  it("returns a conflict without exposing a missing or non-owner Vault", async () => {
    const handler = createPersonalVaultNameMigrationHandler({
      authenticate: async () => user,
      personalVaults: { migrateName: async () => "conflict" },
    });
    const response = await handler(request(body));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "personal_vault_name_migration_conflict" });
  });

  it("rejects unsupported fields, wrong envelope versions, and unstable operation identifiers", async () => {
    const migrateName = vi.fn().mockResolvedValue("committed");
    const handler = createPersonalVaultNameMigrationHandler({
      authenticate: async () => user,
      personalVaults: { migrateName },
    });
    const unsupported = await handler(request({ ...body, plaintext: "forbidden" }));
    const wrongVersion = await handler(request({ ...body, replacementEnvelopeVersion: 1 }));
    const unstableOperation = await handler(request({ ...body, operationId: "C".repeat(43) }));

    expect(unsupported.status).toBe(400);
    expect(wrongVersion.status).toBe(400);
    expect(unstableOperation.status).toBe(400);
    expect(migrateName).not.toHaveBeenCalled();
  });
});

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
