import { describe, expect, it, vi } from "vitest";
import { ApiRequest } from "@api/http/api-request";
import { createUserEncryptionIdentityHandler } from "@api/route-handlers/user-encryption-identity/route";
import { ApplicationUser } from "@api/modules/identity/domain/application-user";

const payload = {
  publicKey: { kty: "EC", crv: "P-256", x: "A".repeat(43), y: "B".repeat(43) },
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
    const registerUserEncryptionIdentity = vi.fn().mockResolvedValue(true);
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

  it("fails closed when another client already registered an identity", async () => {
    const handler = createUserEncryptionIdentityHandler({
      authenticate: async () => user,
      cryptoProfiles: {
        get: async () => null,
        registerUserEncryptionIdentity: async () => false,
        rewrapUserRootKey: async () => undefined,
      },
    });

    const response = await handler(request(payload));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "identity_already_registered" });
  });

  it("rejects a private JWK", async () => {
    const handler = createUserEncryptionIdentityHandler({
      authenticate: async () => user,
      cryptoProfiles: {
        get: async () => null,
        registerUserEncryptionIdentity: async () => true,
        rewrapUserRootKey: async () => undefined,
      },
    });

    const response = await handler(request({ ...payload, publicKey: { ...payload.publicKey, d: "private" } }));

    expect(response.status).toBe(400);
  });
});
