import { describe, expect, it, vi } from "vitest";
import { ApiRequest } from "@api/http/api-request";
import { createUserCryptoProfileMigrationHandler } from "@api/route-handlers/user-crypto-profile/migration/route";
import { ApplicationUser } from "@api/modules/identity/domain/application-user";
import type { UserCryptoProfileMigration } from "@api/modules/identity/application/user-crypto-profile-repository";

const user = new ApplicationUser("synthetic-user", "rhasia:passwordless", "local-id", "demo@example.test", "ACTIVE");
const expected = bytesToBase64(envelope(1, 5));
const replacement = bytesToBase64(envelope(2, 8));
const body = { encryptedPersonalVaultKey: { expectedCiphertext: expected, replacementCiphertext: replacement } };
const request = (value: unknown) =>
  new ApiRequest("https://api.example.test/v1/user-crypto-profile/migration", {
    method: "POST",
    body: JSON.stringify(value),
  });

describe("POST /v1/user-crypto-profile/migration contract", () => {
  it("persists only validated opaque wrapper ciphertext and clears request buffers", async () => {
    let captured: UserCryptoProfileMigration | undefined;
    let expectedCopy: Uint8Array | undefined;
    let replacementCopy: Uint8Array | undefined;
    const migrateUserCryptoProfile = vi.fn(async (_userId: string, migration: UserCryptoProfileMigration) => {
      captured = migration;
      expectedCopy = migration.encryptedPersonalVaultKey?.expectedCiphertext.slice();
      replacementCopy = migration.encryptedPersonalVaultKey?.replacementCiphertext.slice();
      return "committed" as const;
    });
    const handler = createUserCryptoProfileMigrationHandler({
      authenticate: async () => user,
      cryptoProfiles: { migrateUserCryptoProfile },
    });

    const response = await handler(request(body));

    expect(response.status).toBe(204);
    expect(migrateUserCryptoProfile).toHaveBeenCalledWith(
      "synthetic-user",
      expect.objectContaining({
        encryptedPersonalVaultKey: {
          expectedCiphertext: expect.any(Uint8Array),
          replacementCiphertext: expect.any(Uint8Array),
        },
      }),
    );
    expect(expectedCopy?.[0]).toBe(1);
    expect(replacementCopy?.[0]).toBe(2);
    expect(captured?.encryptedPersonalVaultKey?.expectedCiphertext.every((byte) => byte === 0)).toBe(true);
    expect(captured?.encryptedPersonalVaultKey?.replacementCiphertext.every((byte) => byte === 0)).toBe(true);
  });

  it("maps a stale compare-and-swap source to a bounded conflict", async () => {
    const handler = createUserCryptoProfileMigrationHandler({
      authenticate: async () => user,
      cryptoProfiles: { migrateUserCryptoProfile: async () => "conflict" },
    });

    const response = await handler(request(body));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "profile_migration_conflict" });
  });

  it("rejects empty, unsupported, malformed, and non-v1-to-v2 migrations", async () => {
    const migrateUserCryptoProfile = vi.fn().mockResolvedValue("committed");
    const handler = createUserCryptoProfileMigrationHandler({
      authenticate: async () => user,
      cryptoProfiles: { migrateUserCryptoProfile },
    });
    const unsupportedField = await handler(request({ ...body, plaintext: "forbidden" }));
    const emptyMigration = await handler(request({}));
    const wrongSourceVersion = await handler(
      request({
        encryptedPersonalVaultKey: {
          expectedCiphertext: bytesToBase64(envelope(2, 1)),
          replacementCiphertext: replacement,
        },
      }),
    );
    const wrongTargetVersion = await handler(
      request({
        encryptedPersonalVaultKey: {
          expectedCiphertext: expected,
          replacementCiphertext: bytesToBase64(envelope(1, 1)),
        },
      }),
    );

    expect(unsupportedField.status).toBe(400);
    expect(emptyMigration.status).toBe(400);
    expect(wrongSourceVersion.status).toBe(400);
    expect(wrongTargetVersion.status).toBe(400);
    expect(migrateUserCryptoProfile).not.toHaveBeenCalled();
  });
});

function envelope(version: number, value: number): Uint8Array {
  return Uint8Array.from({ length: 64 }, (_, index) => (index === 0 ? version : value));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
