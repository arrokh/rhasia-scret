import { describe, expect, it } from "vitest";
import {
  SecureShareLinkHttpTransport,
  SecureShareLinkHttpTransportError,
  type AuthenticatedTransport,
  type PlatformHttpRequest,
  type PlatformHttpResponse,
} from "../src";

const verifier = Buffer.alloc(32, 3).toString("base64");
const ciphertext = Buffer.alloc(29, 7).toString("base64");

describe("SecureShareLinkHttpTransport", () => {
  it("creates a link with normalized recipient and ciphertext-only material", async () => {
    const transport = new StubTransport([response(201, { id: "invitation_1", expiresAt: "2026-09-08T00:00:00.000Z" })]);
    const protocol = new SecureShareLinkHttpTransport(transport);
    await expect(
      protocol.create("vault_1", {
        recipientEmail: " Recipient@Example.test ",
        linkVerifier: verifier,
        encryptedPackage: ciphertext,
      }),
    ).resolves.toEqual({ id: "invitation_1", expiresAt: "2026-09-08T00:00:00.000Z" });
    expect(transport.requests[0]).toEqual({
      url: "/api/shared-vaults/vault_1/share-links",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        recipientEmail: "recipient@example.test",
        linkVerifier: verifier,
        encryptedPackage: ciphertext,
      }),
      cache: "no-store",
    });
  });

  it("looks up and redeems a one-time link without sending its secret", async () => {
    const transport = new StubTransport([
      response(200, { id: "invitation_1", vaultId: "vault_1", encryptedPackage: ciphertext }),
      response(204, null),
    ]);
    const protocol = new SecureShareLinkHttpTransport(transport);
    await expect(protocol.lookup(verifier)).resolves.toEqual({
      id: "invitation_1",
      vaultId: "vault_1",
      encryptedPackage: ciphertext,
    });
    await protocol.redeem({ invitationId: "invitation_1", encryptedVaultKey: ciphertext, keyVersion: 1 });
    expect(transport.requests[0]?.url).toBe(`/api/secure-share-links?verifier=${encodeURIComponent(verifier)}`);
    expect(String(transport.requests[1]?.body)).toBe(
      JSON.stringify({ invitationId: "invitation_1", encryptedVaultKey: ciphertext, keyVersion: 1 }),
    );
    expect(JSON.stringify(transport.requests)).not.toContain("client-link-secret");
  });

  it("cancels the exact pending invitation", async () => {
    const transport = new StubTransport([response(204, null)]);
    await new SecureShareLinkHttpTransport(transport).cancel("vault_1", "invitation_1");
    expect(transport.requests[0]).toEqual({
      url: "/api/shared-vaults/vault_1/share-links/invitation_1",
      method: "DELETE",
      cache: "no-store",
    });
  });

  it("strictly parses responses and preserves expiry/error statuses", async () => {
    const malformed = new SecureShareLinkHttpTransport(
      new StubTransport([
        response(200, { id: "invitation_1", vaultId: "vault_1", encryptedPackage: ciphertext, secret: "forbidden" }),
      ]),
    );
    await expect(malformed.lookup(verifier)).rejects.toThrow("protocol value is invalid");

    const expired = new SecureShareLinkHttpTransport(
      new StubTransport([response(404, { error: "share_link_unavailable" })]),
    );
    await expect(expired.lookup(verifier)).rejects.toEqual(
      new SecureShareLinkHttpTransportError(404, "share_link_unavailable"),
    );
  });

  it("does not forward unexpected runtime request fields", async () => {
    const transport = new StubTransport([response(201, { id: "invitation_1", expiresAt: "2026-09-08T00:00:00.000Z" })]);
    const protocol = new SecureShareLinkHttpTransport(transport);
    await protocol.create("vault_1", {
      recipientEmail: "recipient@example.test",
      linkVerifier: verifier,
      encryptedPackage: ciphertext,
      secret: "client-link-secret",
    } as unknown as { recipientEmail: string; linkVerifier: string; encryptedPackage: string });
    expect(JSON.parse(String(transport.requests[0]?.body))).toEqual({
      recipientEmail: "recipient@example.test",
      linkVerifier: verifier,
      encryptedPackage: ciphertext,
    });
  });

  it("rejects oversized recipient emails before regex processing", async () => {
    const protocol = new SecureShareLinkHttpTransport(new StubTransport([]));

    await expect(
      protocol.create("vault_1", {
        recipientEmail: `${"a".repeat(310)}@example.test`,
        linkVerifier: verifier,
        encryptedPackage: ciphertext,
      }),
    ).rejects.toThrow("protocol value is invalid");
  });
});

class StubTransport implements AuthenticatedTransport {
  public readonly requests: PlatformHttpRequest[] = [];
  public constructor(private readonly responses: PlatformHttpResponse[]) {}
  public async request(request: PlatformHttpRequest): Promise<PlatformHttpResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (!response) throw new Error("Missing response.");
    return response;
  }
}

function response(status: number, body: unknown): PlatformHttpResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    json: async <Value>() => body as Value,
    bytes: async () => new Uint8Array(),
    text: async () => (body === null ? "" : JSON.stringify(body)),
  };
}
