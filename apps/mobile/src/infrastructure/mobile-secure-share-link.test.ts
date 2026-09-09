import { sha256 } from "@noble/hashes/sha2.js";
import { Share } from "react-native";
import type {
  AuthenticatedTransport,
  PlatformHttpRequest,
  PlatformHttpResponse,
} from "@rhasia-scret/client-vault-core";
import { base64ToBytes, bytesToBase64 } from "@rhasia-scret/client-vault-core";
import { createMobileSecureShareLink, redeemMobileSecureShareLink } from "./mobile-secure-share-link";
import { nativeClientCrypto } from "./native-client-crypto";

describe("mobile Secure Share Links", () => {
  const webOrigin = "https://vault.example.test";

  afterEach(() => jest.restoreAllMocks());

  it("creates server-held ciphertext metadata and shares the client secret only through the native share sheet", async () => {
    const share = jest.spyOn(Share, "share").mockResolvedValue({ action: Share.sharedAction });
    const transport = new CreateLinkTransport();
    const key = new Uint8Array(32).fill(6);
    await createMobileSecureShareLink({ id: "shared_1", key }, "Recipient@Example.test", transport, webOrigin);

    const body = String(transport.requests[0].body);
    expect(body).toContain("recipient@example.test");
    expect(body).not.toContain("/vaults/invitations/redeem#");
    expect(share).toHaveBeenCalledWith({
      message: expect.stringMatching(/^https:\/\/vault\.example\.test\/vaults\/invitations\/redeem#[A-Za-z0-9_-]+$/),
    });
    key.fill(0);
  });

  it("revokes a newly-created invitation when the native share sheet is dismissed", async () => {
    jest.spyOn(Share, "share").mockResolvedValue({ action: Share.dismissedAction });
    const transport = new CreateLinkTransport();
    const key = new Uint8Array(32).fill(6);
    await expect(
      createMobileSecureShareLink({ id: "shared_1", key }, "recipient@example.test", transport, webOrigin),
    ).rejects.toThrow("cancelled");
    expect(transport.requests[1]).toEqual({
      url: "/api/shared-vaults/shared_1/share-links/invitation_1",
      method: "DELETE",
      cache: "no-store",
    });
    key.fill(0);
  });

  it("keeps link material client-only and sends only verifier and recipient-wrapped Vault key", async () => {
    const secret = "test-client-only-link-secret-123";
    const vaultId = "shared_1";
    const vaultKey = new Uint8Array(32).fill(7);
    const userRootKey = new Uint8Array(32).fill(9);
    const linkKey = sha256(new TextEncoder().encode(`shared-totp-vault:share-link:v1:${secret}`));
    const encryptedPackage = nativeClientCrypto.serializeEncryptedEnvelope(
      await nativeClientCrypto.encryptPayloadWithContext(linkKey, vaultKey, {
        purpose: "secure-share-link",
        payloadType: "vault-encryption-key",
        vaultId,
        keyVersion: 1,
      }),
    );
    linkKey.fill(0);
    const transport = new ShareLinkTransport({
      id: "invitation_1",
      vaultId,
      encryptedPackage: bytesToBase64(encryptedPackage),
    });

    await redeemMobileSecureShareLink(secret, userRootKey, transport);

    expect(transport.requests[0].url).toMatch(/^\/api\/secure-share-links\?verifier=/);
    expect(String(transport.requests[1].body)).not.toContain(secret);
    const request = JSON.parse(String(transport.requests[1].body)) as { encryptedVaultKey: string };
    const envelope = nativeClientCrypto.deserializeEncryptedEnvelope(base64ToBytes(request.encryptedVaultKey));
    const unwrapped = await nativeClientCrypto.decryptPayloadWithContext(userRootKey, envelope, {
      purpose: "vault-key-wrap",
      payloadType: "vault-encryption-key",
      vaultId,
      keyVersion: 1,
    });
    expect(unwrapped).toEqual(vaultKey);
    unwrapped.fill(0);
    vaultKey.fill(0);
    userRootKey.fill(0);
    encryptedPackage.fill(0);
  });
});

class CreateLinkTransport implements AuthenticatedTransport {
  public readonly requests: PlatformHttpRequest[] = [];
  public async request(request: PlatformHttpRequest): Promise<PlatformHttpResponse> {
    this.requests.push(request);
    const result = { id: "invitation_1", expiresAt: "2026-08-18T00:00:00.000Z" };
    return {
      status: 201,
      ok: true,
      headers: { get: () => null },
      json: async <Value>() => result as Value,
      bytes: async () => new Uint8Array(),
      text: async () => JSON.stringify(result),
    };
  }
}

class ShareLinkTransport implements AuthenticatedTransport {
  public readonly requests: PlatformHttpRequest[] = [];
  public constructor(private readonly lookup: { id: string; vaultId: string; encryptedPackage: string }) {}
  public async request(request: PlatformHttpRequest): Promise<PlatformHttpResponse> {
    this.requests.push(request);
    const body = request.method === "GET" ? this.lookup : null;
    return {
      status: request.method === "GET" ? 200 : 204,
      ok: true,
      headers: { get: () => null },
      json: async <Value>() => body as Value,
      bytes: async () => new Uint8Array(),
      text: async () => JSON.stringify(body),
    };
  }
}
