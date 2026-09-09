import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  redeemSecureShareLinkMaterial: vi.fn(),
}));
vi.mock("@/shared/infrastructure/browser-api-client", () => ({
  browserAuthenticatedTransport: { request: mocks.request },
}));
vi.mock("@/modules/vault-membership/infrastructure/browser-secure-share-link-redemption", () => ({
  redeemSecureShareLinkMaterial: mocks.redeemSecureShareLinkMaterial,
}));

import { redeemSecureShareLink } from "@/modules/vault-membership/infrastructure/browser-secure-share-link-workflow";

describe("redeemSecureShareLink", () => {
  afterEach(() => vi.clearAllMocks());

  it("uses a verifier for lookup and sends only the recipient-wrapped Vault Encryption Key", async () => {
    const encryptedPackage = new Uint8Array(13).fill(2);
    const encryptedVaultKey = new Uint8Array(13).fill(3);
    const expectedEncryptedPackage = encryptedPackage.slice();
    const expectedEncryptedVaultKey = Buffer.from(encryptedVaultKey).toString("base64");
    const userRootKey = new Uint8Array(32).fill(4);
    const secret = "client-only-secret";
    const linkVerifier = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)));
    let receivedEncryptedPackage: Uint8Array | undefined;
    const lookup = {
      id: "invitation-1",
      vaultId: "vault-1",
      encryptedPackage: Buffer.from(encryptedPackage).toString("base64"),
    };
    mocks.request.mockImplementation(async (request: { method: string }) =>
      response(request.method === "GET" ? 200 : 204, request.method === "GET" ? lookup : null),
    );
    mocks.redeemSecureShareLinkMaterial.mockImplementation(async (_secret: string, packageBytes: Uint8Array) => {
      receivedEncryptedPackage = packageBytes.slice();
      return { linkVerifier, encryptedVaultKey };
    });
    await redeemSecureShareLink(secret, userRootKey);

    expect(mocks.request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        url: expect.stringMatching(/^\/api\/secure-share-links\?verifier=/),
        method: "GET",
        cache: "no-store",
      }),
    );
    expect(String(mocks.request.mock.calls[0]?.[0].url)).not.toContain(secret);
    expect(receivedEncryptedPackage).toEqual(expectedEncryptedPackage);
    expect(mocks.redeemSecureShareLinkMaterial).toHaveBeenCalledWith(
      secret,
      expect.any(Uint8Array),
      userRootKey,
      "vault-1",
    );
    expect(mocks.request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        url: "/api/secure-share-links",
        method: "POST",
        body: JSON.stringify({
          invitationId: "invitation-1",
          encryptedVaultKey: expectedEncryptedVaultKey,
          keyVersion: 1,
        }),
      }),
    );
  });

  it("does not redeem when decrypted material does not match the requested verifier", async () => {
    const lookup = { id: "invitation-1", vaultId: "vault-1", encryptedPackage: Buffer.alloc(13).toString("base64") };
    mocks.request.mockResolvedValue(response(200, lookup));
    mocks.redeemSecureShareLinkMaterial.mockResolvedValue({
      linkVerifier: new Uint8Array(32).fill(9),
      encryptedVaultKey: new Uint8Array(13).fill(3),
    });

    await expect(redeemSecureShareLink("client-only-secret", new Uint8Array(32))).rejects.toThrow("verifier mismatch");
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
});

function response(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    json: async <Value>() => body as Value,
    bytes: async () => new Uint8Array(),
    text: async () => (body === null ? "" : JSON.stringify(body)),
  };
}
