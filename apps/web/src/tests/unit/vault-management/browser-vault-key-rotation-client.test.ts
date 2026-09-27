import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getJson: vi.fn(), patchEmpty: vi.fn() }));
vi.mock("@/shared/infrastructure/browser-api-client", () => ({
  browserApiClient: mocks,
}));

import { loadBrowserVaultKeyRotationSnapshot } from "@/modules/vault-management/infrastructure/browser-vault-key-rotation-client";

const publicKey = { kty: "EC", crv: "P-256", x: "A".repeat(43), y: "B".repeat(43) };
const ciphertext = Buffer.alloc(13, 7).toString("base64");
const snapshot = {
  vaultId: "vault-1",
  encryptedName: ciphertext,
  encryptionVersion: 1,
  currentKeyVersion: 2,
  pendingInvitationCount: 1,
  accounts: [
    {
      id: "account-1",
      encryptedPayload: ciphertext,
      encryptionVersion: 1,
      revision: 3,
      recoverableDeleted: true,
    },
  ],
  members: [{ userId: "member-1", publicKey, keyVersion: 2 }],
};

describe("loadBrowserVaultKeyRotationSnapshot", () => {
  afterEach(() => vi.clearAllMocks());

  it("accepts only the bounded, exact encrypted snapshot shape", async () => {
    mocks.getJson.mockResolvedValue(snapshot);

    await expect(loadBrowserVaultKeyRotationSnapshot("vault-1")).resolves.toEqual(snapshot);
    expect(mocks.getJson).toHaveBeenCalledWith("/api/v1/shared-vaults/vault-1/rotation", { cache: "no-store" });
  });

  it("rejects unknown fields and private identity key material", async () => {
    mocks.getJson.mockResolvedValueOnce({ ...snapshot, secret: "forbidden" });
    await expect(loadBrowserVaultKeyRotationSnapshot("vault-1")).rejects.toThrow("rotation response is invalid");

    mocks.getJson.mockResolvedValueOnce({
      ...snapshot,
      members: [{ userId: "member-1", publicKey: { ...publicKey, d: "synthetic-private-material" }, keyVersion: 2 }],
    });
    await expect(loadBrowserVaultKeyRotationSnapshot("vault-1")).rejects.toThrow("public key is invalid");
  });
});
