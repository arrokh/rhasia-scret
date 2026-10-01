import { describe, expect, it, vi } from "vitest";
import {
  initializePersonalVault,
  PersonalVaultInitializationError,
} from "@/modules/vault-management/infrastructure/browser-vault-management-client";

const request = {
  vaultUnlockSalt: "AAAAAAAAAAAAAAAAAAAAAA==",
  wrappedUserRootKey: "AAAAAAAAAAAAAAAAAAAAAA==",
  encryptedPersonalVaultKey: "AAAAAAAAAAAAAAAAAAAAAA==",
  encryptedVaultName: "AAAAAAAAAAAAAAAAAAAAAA==",
  userEncryptionPublicKey: { kty: "EC", crv: "P-256", x: "A".repeat(43), y: "A".repeat(43) },
  encryptedUserPrivateKey: "AAAAAAAAAAAAAAAAAAAAAA==",
  userEncryptionKeyVersion: 1,
  encryptionVersion: 1,
};

describe("initializePersonalVault", () => {
  it.each([
    [400, "invalid_request"],
    [422, "invalid_request"],
    [401, "unauthenticated"],
    [403, "forbidden"],
    [409, "conflict"],
    [429, "rate_limited"],
    [500, "server_error"],
    [418, "unexpected_response"],
  ] as const)("maps HTTP %i to a fixed failure category", async (status, category) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ error: "synthetic-untrusted-response-detail" }), { status })),
    );

    const failure = await initializePersonalVault(request).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PersonalVaultInitializationError);
    expect(failure).toMatchObject({ category, message: "Personal Vault initialization failed." });
    expect(failure).not.toHaveProperty("cause");
  });

  it("maps transport failures without retaining their raw detail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("synthetic transport detail")));

    const failure = await initializePersonalVault(request).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PersonalVaultInitializationError);
    expect(failure).toMatchObject({ category: "transport_error", message: "Personal Vault initialization failed." });
    expect(failure).not.toHaveProperty("cause");
  });
});
