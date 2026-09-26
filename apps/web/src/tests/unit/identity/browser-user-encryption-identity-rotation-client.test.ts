import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserPublicEncryptionKey } from "@/shared/infrastructure/browser-public-encryption-key";

const mocks = vi.hoisted(() => ({ getJson: vi.fn(), patchEmpty: vi.fn() }));
vi.mock("@/shared/infrastructure/browser-api-client", () => ({
  browserApiClient: mocks,
}));

import {
  loadBrowserUserEncryptionIdentityRotationSnapshot,
  submitBrowserUserEncryptionIdentityRotation,
  type BrowserUserEncryptionIdentityRotationRequest,
} from "@/modules/identity/infrastructure/browser-user-encryption-identity-rotation-client";

const publicKey: BrowserPublicEncryptionKey = {
  kty: "EC",
  crv: "P-256",
  x: "A".repeat(43),
  y: "B".repeat(43),
  ext: true,
  key_ops: [],
};
const ciphertext = Buffer.alloc(13, 7).toString("base64");
const snapshot = {
  encryptedPrivateKey: ciphertext,
  encryptionVersion: 1,
  publicKey,
  memberships: [{ vaultId: "vault-1", keyVersion: 2, encryptedVaultKey: ciphertext }],
};

describe("loadBrowserUserEncryptionIdentityRotationSnapshot", () => {
  afterEach(() => vi.clearAllMocks());

  it("accepts only a bounded snapshot containing the public key and encrypted wraps", async () => {
    mocks.getJson.mockResolvedValue(snapshot);

    await expect(loadBrowserUserEncryptionIdentityRotationSnapshot()).resolves.toEqual(snapshot);
    expect(mocks.getJson).toHaveBeenCalledWith("/api/v1/user-encryption-identity/rotation", { cache: "no-store" });
  });

  it("submits expected membership generations using the API contract field", async () => {
    const request = {
      expectedPublicKey: publicKey,
      expectedEncryptedPrivateKey: ciphertext,
      expectedEncryptionVersion: 1,
      publicKey: { ...publicKey, x: "C".repeat(43) },
      encryptedPrivateKey: ciphertext,
      encryptionVersion: 1,
      memberships: [
        {
          vaultId: "vault-1",
          expectedKeyVersion: 2,
          expectedEncryptedVaultKey: ciphertext,
          encryptedVaultKey: ciphertext,
        },
      ],
    } satisfies BrowserUserEncryptionIdentityRotationRequest;
    mocks.patchEmpty.mockResolvedValue(undefined);

    await submitBrowserUserEncryptionIdentityRotation(request);

    expect(mocks.patchEmpty).toHaveBeenCalledWith("/api/v1/user-encryption-identity/rotation", request);
  });

  it("rejects private key fields and unsupported response properties", async () => {
    mocks.getJson.mockResolvedValueOnce({ ...snapshot, encryptedSecret: "forbidden" });
    await expect(loadBrowserUserEncryptionIdentityRotationSnapshot()).rejects.toThrow("rotation response is invalid");

    mocks.getJson.mockResolvedValueOnce({ ...snapshot, encryptionVersion: 2 });
    await expect(loadBrowserUserEncryptionIdentityRotationSnapshot()).rejects.toThrow("rotation response is invalid");

    mocks.getJson.mockResolvedValueOnce({
      ...snapshot,
      publicKey: { ...publicKey, d: "synthetic-private-material" },
    });
    await expect(loadBrowserUserEncryptionIdentityRotationSnapshot()).rejects.toThrow("public key is invalid");
  });
});
