import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createUserEncryptionIdentityHandler } from "@/app/api/user-encryption-identity/route";
import { ApplicationUser } from "@/modules/identity/domain/application-user";

const payload = {
  publicKey: { kty: "EC", crv: "P-256", x: "public-x", y: "public-y" },
  encryptedPrivateKey: Buffer.from("encrypted-private-key-material").toString("base64"),
  encryptionVersion: 1,
};

describe("PUT /api/user-encryption-identity contract", () => {
  it("registers only a public key and encrypted private-key backup", async () => {
    const registerUserEncryptionIdentity = vi.fn().mockResolvedValue(undefined);
    const handler = createUserEncryptionIdentityHandler({
      authenticate: async () =>
        new ApplicationUser("user-1", "supabase", "supabase-1", "person@example.test", "ACTIVE"),
      cryptoProfiles: {
        get: async () => null,
        registerUserEncryptionIdentity,
        rewrapUserRootKey: async () => undefined,
      },
    });
    const response = await handler(
      new NextRequest("http://localhost/api/user-encryption-identity", {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    );
    expect(response.status).toBe(204);
    expect(registerUserEncryptionIdentity).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ encryptionVersion: 1 }),
    );
  });

  it("rejects a private JWK", async () => {
    const handler = createUserEncryptionIdentityHandler({
      authenticate: async () =>
        new ApplicationUser("user-1", "supabase", "supabase-1", "person@example.test", "ACTIVE"),
      cryptoProfiles: {
        get: async () => null,
        registerUserEncryptionIdentity: async () => undefined,
        rewrapUserRootKey: async () => undefined,
      },
    });
    const response = await handler(
      new NextRequest("http://localhost/api/user-encryption-identity", {
        method: "PUT",
        body: JSON.stringify({ ...payload, publicKey: { ...payload.publicKey, d: "private" } }),
      }),
    );
    expect(response.status).toBe(400);
  });
});
