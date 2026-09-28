import { describe, expect, it, vi } from "vitest";
import { ApiRequest, ApiResponse } from "@api/http/api-request";
import { ApplicationUser } from "@api/modules/identity/domain/application-user";
import { createSharedVaultKeyWrapMigrationHandler } from "@api/route-handlers/shared-vaults/[vaultId]/key-wrap/migration/route";
import type { EncryptedPayloadMigration } from "@api/shared/application/encrypted-payload-migration";

const user = new ApplicationUser("synthetic-user", "rhasia:passwordless", "local-id", "demo@example.test", "ACTIVE");
const replacement = new TextEncoder().encode(
  JSON.stringify({
    version: 2,
    nonce: "synthetic-fresh-nonce",
    ciphertext: "synthetic-ciphertext",
    ephemeralPublicKey: { kty: "EC", crv: "P-256", x: "synthetic-x", y: "synthetic-y" },
  }),
);
const body = {
  expectedKeyVersion: 4,
  expectedEnvelopeVersion: 1,
  replacementEnvelopeVersion: 2,
  expectedCiphertextDigest: "A".repeat(43),
  replacementCiphertextDigest: `${"B".repeat(42)}E`,
  replacementCiphertext: base64(replacement),
  operationId: `${"B".repeat(42)}E`,
};
const context = { params: Promise.resolve({ vaultId: "vault-synthetic" }) };
const request = (value: unknown) =>
  new ApiRequest("https://api.example.test/v1/shared-vaults/vault-synthetic/key-wrap/migration", {
    method: "POST",
    body: JSON.stringify(value),
  });

describe("POST /v1/shared-vaults/:vaultId/key-wrap/migration", () => {
  it("requires key-material mutation assurance and commits opaque replacement bytes", async () => {
    let captured: EncryptedPayloadMigration | undefined;
    const migrateKeyWrap = vi.fn(
      async (_userId: string, _vaultId: string, _keyVersion: number, migration: EncryptedPayloadMigration) => {
        captured = migration;
        return "committed" as const;
      },
    );
    const authenticate = vi.fn(async () => user);
    const handler = createSharedVaultKeyWrapMigrationHandler({ authenticate, memberships: { migrateKeyWrap } });
    const apiRequest = request(body);

    const response = await handler(apiRequest, context);

    expect(response.status).toBe(204);
    expect(authenticate).toHaveBeenCalledWith(apiRequest, "key_material_mutation", "fresh-provider-user");
    expect(migrateKeyWrap).toHaveBeenCalledWith(
      "synthetic-user",
      "vault-synthetic",
      4,
      expect.objectContaining({ replacementCiphertext: expect.any(Uint8Array) }),
    );
    expect(captured?.replacementCiphertext.every((byte) => byte === 0)).toBe(true);
  });

  it("maps unavailable memberships to a bounded conflict", async () => {
    const handler = createSharedVaultKeyWrapMigrationHandler({
      authenticate: async () => user,
      memberships: { migrateKeyWrap: async () => "conflict" },
    });
    const response = await handler(request(body), context);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "key_wrap_migration_conflict" });
  });

  it("preserves authentication errors before validation", async () => {
    const handler = createSharedVaultKeyWrapMigrationHandler({
      authenticate: async () => ApiResponse.json({ error: "unauthenticated" }, { status: 401 }),
      memberships: { migrateKeyWrap: vi.fn() },
    });
    const response = await handler(request("invalid"), context);
    expect(response.status).toBe(401);
  });
});

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
