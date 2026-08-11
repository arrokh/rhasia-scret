import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getJson: vi.fn(),
  postEmpty: vi.fn(),
  redeemSecureShareLinkMaterial: vi.fn()
}));
vi.mock("@/shared/infrastructure/browser-api-client", () => ({ browserApiClient: { getJson: mocks.getJson, postEmpty: mocks.postEmpty } }));
vi.mock("@/modules/vault-membership/infrastructure/browser-secure-share-link-redemption", () => ({ redeemSecureShareLinkMaterial: mocks.redeemSecureShareLinkMaterial }));

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
    mocks.getJson.mockResolvedValue({ id: "invitation-1", vaultId: "vault-1", encryptedPackage: Buffer.from(encryptedPackage).toString("base64") });
    mocks.redeemSecureShareLinkMaterial.mockImplementation(async (_secret: string, packageBytes: Uint8Array) => {
      receivedEncryptedPackage = packageBytes.slice();
      return { linkVerifier, encryptedVaultKey };
    });
    mocks.postEmpty.mockResolvedValue(undefined);

    await redeemSecureShareLink(secret, userRootKey);

    expect(mocks.getJson).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/secure-share-links\?verifier=/), { cache: "no-store" });
    expect(String(mocks.getJson.mock.calls[0]?.[0])).not.toContain(secret);
    expect(receivedEncryptedPackage).toEqual(expectedEncryptedPackage);
    expect(mocks.redeemSecureShareLinkMaterial).toHaveBeenCalledWith(secret, expect.any(Uint8Array), userRootKey, "vault-1");
    expect(mocks.postEmpty).toHaveBeenCalledWith("/api/secure-share-links", {
      invitationId: "invitation-1",
      encryptedVaultKey: expectedEncryptedVaultKey,
      keyVersion: 1
    });
  });

  it("does not redeem when decrypted material does not match the requested verifier", async () => {
    mocks.getJson.mockResolvedValue({ id: "invitation-1", vaultId: "vault-1", encryptedPackage: Buffer.alloc(13).toString("base64") });
    mocks.redeemSecureShareLinkMaterial.mockResolvedValue({ linkVerifier: new Uint8Array(32).fill(9), encryptedVaultKey: new Uint8Array(13).fill(3) });

    await expect(redeemSecureShareLink("client-only-secret", new Uint8Array(32))).rejects.toThrow("verifier mismatch");
    expect(mocks.postEmpty).not.toHaveBeenCalled();
  });
});
