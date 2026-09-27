import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { ApiRequest, ApiResponse } from "@api/http/api-request";
import { createGetUserCryptoProfileHandler } from "@api/route-handlers/user-crypto-profile/route";
import { ApplicationUser } from "@api/modules/identity/domain/application-user";

const user = new ApplicationUser("user-1", "rhasia:passwordless", "subject-1", "owner@example.test", "ACTIVE");
const request = new ApiRequest("https://api.example.test/v1/user-crypto-profile");

const profile = {
  vaultUnlockSalt: Uint8Array.from([1, 2, 3]),
  wrappedUserRootKey: Uint8Array.from([4, 5, 6]),
  encryptedPersonalVaultKey: Uint8Array.from([7, 8, 9]),
  encryptionVersion: 1,
  userEncryptionPublicKey: { kty: "EC", crv: "P-256", x: "x", y: "y" },
  encryptedUserPrivateKey: Uint8Array.from([10, 11, 12]),
};

describe("GET /v1/user-crypto-profile contract", () => {
  it("returns encrypted profile material and no plaintext identity data", async () => {
    const handler = createGetUserCryptoProfileHandler({
      authenticate: async () => user,
      cryptoProfiles: {
        get: async () => profile,
        registerUserEncryptionIdentity: async () => true,
        rewrapUserRootKey: async () => undefined,
      },
    });

    const response = await handler(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      vaultUnlockSalt: Buffer.from([1, 2, 3]).toString("base64"),
      wrappedUserRootKey: Buffer.from([4, 5, 6]).toString("base64"),
      encryptedPersonalVaultKey: Buffer.from([7, 8, 9]).toString("base64"),
      encryptionVersion: 1,
      userEncryptionPublicKey: profile.userEncryptionPublicKey,
      encryptedUserPrivateKey: Buffer.from([10, 11, 12]).toString("base64"),
    });
  });

  it("returns a generic initialization miss and does not expose authentication failures", async () => {
    const missing = createGetUserCryptoProfileHandler({
      authenticate: async () => user,
      cryptoProfiles: {
        get: async () => null,
        registerUserEncryptionIdentity: async () => true,
        rewrapUserRootKey: async () => undefined,
      },
    });
    const denied = createGetUserCryptoProfileHandler({
      authenticate: async () => ApiResponse.json({ error: "unauthenticated" }, { status: 401 }),
      cryptoProfiles: {
        get: async () => {
          throw new Error("must not read");
        },
        registerUserEncryptionIdentity: async () => true,
        rewrapUserRootKey: async () => undefined,
      },
    });

    expect((await missing(request)).status).toBe(404);
    expect((await denied(request)).status).toBe(401);
  });
});
