import { describe, expect, it, vi } from "vitest";
import { ApiRequest } from "@api/http/api-request";
import { createUserEncryptionIdentityHandler } from "@api/route-handlers/user-encryption-identity/route";
import { ApplicationUser } from "@api/modules/identity/domain/application-user";

const payload = {
  publicKey: { kty: "EC", crv: "P-256", x: "public-x", y: "public-y" },
  encryptedPrivateKey: btoa("encrypted-private-key-material"),
  encryptionVersion: 1 as const,
};
const user = new ApplicationUser("user-1", "rhasia:passwordless", "local-1", "person@example.test", "ACTIVE");
const request = (body: unknown) =>
  new ApiRequest("https://api.example.test/v1/user-encryption-identity", {
    method: "PUT",
    body: JSON.stringify(body),
  });

describe("PUT /v1/user-encryption-identity contract", () => {
  it("registers only a public key and encrypted private-key backup", async () => {
    const registerUserEncryptionIdentity = vi.fn().mockResolvedValue(undefined);
    const handler = createUserEncryptionIdentityHandler({
      authenticate: async () => user,
      cryptoProfiles: {
        get: async () => null,
        registerUserEncryptionIdentity,
        rewrapUserRootKey: async () => undefined,
      },
    });

    const response = await handler(request(payload));

    expect(response.status).toBe(204);
    expect(registerUserEncryptionIdentity).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ encryptionVersion: 1, encryptedPrivateKey: expect.any(Uint8Array) }),
    );
  });

  it("rejects a private JWK", async () => {
    const handler = createUserEncryptionIdentityHandler({
      authenticate: async () => user,
      cryptoProfiles: {
        get: async () => null,
        registerUserEncryptionIdentity: async () => undefined,
        rewrapUserRootKey: async () => undefined,
      },
    });

    const response = await handler(request({ ...payload, publicKey: { ...payload.publicKey, d: "private" } }));

    expect(response.status).toBe(400);
  });
});
