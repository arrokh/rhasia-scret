import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequest } from "@api/http/api-request";
import { ApplicationUser } from "@api/modules/identity/domain/application-user";

const mocks = vi.hoisted(() => ({
  authenticateReader: vi.fn(),
  authenticateMutation: vi.fn(),
  snapshot: vi.fn(),
  rotate: vi.fn(),
}));

vi.mock("@api/http/api-context", () => ({
  getApiRequestContext: () => ({ applicationRuntime: { userEncryptionIdentityRotation: () => mocks } }),
}));
vi.mock("@api/shared/infrastructure/authenticated-application-request", () => ({
  authenticateApplicationReader: mocks.authenticateReader,
  authenticateApplicationMutation: mocks.authenticateMutation,
}));

import { GET, PATCH } from "@api/route-handlers/user-encryption-identity/rotation/route";

const publicKey = { kty: "EC", crv: "P-256", x: "A".repeat(43), y: "B".repeat(43) };
const user = new ApplicationUser("user-1", "passwordless", "subject-1", "person@example.test", "ACTIVE");
const profileCiphertext = Buffer.alloc(13, 1).toString("base64");
const membershipCiphertext = Buffer.alloc(13, 2).toString("base64");
const nextCiphertext = Buffer.alloc(13, 3).toString("base64");
const request = (method: string, body?: unknown) =>
  new ApiRequest("https://api.example.test/v1/user-encryption-identity/rotation", {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });

beforeEach(() => {
  mocks.authenticateReader.mockResolvedValue(user);
  mocks.authenticateMutation.mockResolvedValue(user);
});
afterEach(() => vi.clearAllMocks());

describe("User Encryption Key Pair rotation routes", () => {
  it("returns only the caller's encrypted profile and active membership packages", async () => {
    mocks.snapshot.mockResolvedValue({
      publicKey,
      encryptedPrivateKey: Buffer.from(profileCiphertext, "base64"),
      encryptionVersion: 1,
      memberships: [
        {
          vaultId: "vault-1",
          ownerId: "other-owner",
          encryptedVaultKey: Buffer.from(membershipCiphertext, "base64"),
          keyVersion: 3,
        },
      ],
    });

    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      publicKey,
      encryptedPrivateKey: profileCiphertext,
      encryptionVersion: 1,
      memberships: [{ vaultId: "vault-1", keyVersion: 3, encryptedVaultKey: membershipCiphertext }],
    });
  });

  it("rejects a malformed or private snapshot key without disclosing profile material", async () => {
    mocks.snapshot.mockResolvedValue({
      publicKey: { ...publicKey, d: "synthetic-private-material" },
      encryptedPrivateKey: Buffer.from(profileCiphertext, "base64"),
      encryptionVersion: 1,
      memberships: [],
    });

    const response = await GET(request("GET"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "identity_rotation_unavailable" });
  });

  it("strictly maps a complete encrypted identity and membership replacement", async () => {
    mocks.rotate.mockResolvedValue(true);
    const body = {
      expectedPublicKey: publicKey,
      expectedEncryptedPrivateKey: profileCiphertext,
      expectedEncryptionVersion: 1,
      publicKey: { ...publicKey, x: "C".repeat(43) },
      encryptedPrivateKey: nextCiphertext,
      encryptionVersion: 1,
      memberships: [
        {
          vaultId: "vault-1",
          expectedKeyVersion: 3,
          expectedEncryptedVaultKey: membershipCiphertext,
          encryptedVaultKey: nextCiphertext,
        },
      ],
    };

    const response = await PATCH(request("PATCH", body));

    expect(response.status).toBe(204);
    expect(mocks.rotate).toHaveBeenCalledWith("user-1", {
      expectedPublicKey: publicKey,
      expectedEncryptedPrivateKey: expect.any(Uint8Array),
      expectedEncryptionVersion: 1,
      publicKey: body.publicKey,
      encryptedPrivateKey: expect.any(Uint8Array),
      encryptionVersion: 1,
      memberships: [
        {
          vaultId: "vault-1",
          expectedKeyVersion: 3,
          expectedEncryptedVaultKey: expect.any(Uint8Array),
          encryptedVaultKey: expect.any(Uint8Array),
        },
      ],
    });
    expect(await response.text()).toBe("");
  });

  it("rejects a membership current-generation field where an expected-generation precondition is required", async () => {
    const body = {
      expectedPublicKey: publicKey,
      expectedEncryptedPrivateKey: profileCiphertext,
      expectedEncryptionVersion: 1,
      publicKey: { ...publicKey, x: "C".repeat(43) },
      encryptedPrivateKey: nextCiphertext,
      encryptionVersion: 1,
      memberships: [
        {
          vaultId: "vault-1",
          keyVersion: 3,
          expectedEncryptedVaultKey: membershipCiphertext,
          encryptedVaultKey: nextCiphertext,
        },
      ],
    };

    const response = await PATCH(request("PATCH", body));

    expect(response.status).toBe(400);
    expect(mocks.rotate).not.toHaveBeenCalled();
  });

  it("rejects duplicate memberships before persistence and maps stale snapshots to conflict", async () => {
    const body = {
      expectedPublicKey: publicKey,
      expectedEncryptedPrivateKey: profileCiphertext,
      expectedEncryptionVersion: 1,
      publicKey: { ...publicKey, x: "C".repeat(43) },
      encryptedPrivateKey: nextCiphertext,
      encryptionVersion: 1,
      memberships: [
        {
          vaultId: "vault-1",
          expectedKeyVersion: 3,
          expectedEncryptedVaultKey: membershipCiphertext,
          encryptedVaultKey: nextCiphertext,
        },
        {
          vaultId: "vault-1",
          expectedKeyVersion: 3,
          expectedEncryptedVaultKey: membershipCiphertext,
          encryptedVaultKey: nextCiphertext,
        },
      ],
    };
    expect((await PATCH(request("PATCH", body))).status).toBe(400);
    expect(mocks.rotate).not.toHaveBeenCalled();

    mocks.rotate.mockResolvedValue(false);
    const staleResponse = await PATCH(request("PATCH", { ...body, memberships: body.memberships.slice(0, 1) }));
    expect(staleResponse.status).toBe(409);
    await expect(staleResponse.json()).resolves.toEqual({ error: "identity_rotation_rejected" });
  });
});
