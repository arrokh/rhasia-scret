import { describe, expect, it } from "vitest";
import {
  AuthorizedOfflineBundleTransport,
  AuthorizedOfflineBundleTransportError,
  bytesToBase64,
  type AuthenticatedTransport,
  type EncryptedOfflineVaultBundle,
  type PlatformHttpRequest,
  type PlatformHttpResponse
} from "../src";

describe("AuthorizedOfflineBundleTransport", () => {
  it("constructs a conditional request and reuses only a validated encrypted snapshot", async () => {
    const cached = fixture();
    const transport = new StubTransport(response(304, null, { "x-synchronized-at": "2026-09-01T01:00:00.000Z" }));
    const protocol = new AuthorizedOfflineBundleTransport(transport);
    await expect(protocol.fetch(cached)).resolves.toEqual({ ...cached, synchronizedAt: "2026-09-01T01:00:00.000Z" });
    expect(transport.requests).toEqual([{
      url: "/api/sync/offline-bundle",
      method: "GET",
      headers: { "if-none-match": '"sync_token_1"' },
      cache: "no-store"
    }]);
  });

  it("strictly parses a changed encrypted bundle", async () => {
    const bundle = fixture();
    const protocol = new AuthorizedOfflineBundleTransport(new StubTransport(response(200, bundle)));
    await expect(protocol.fetch()).resolves.toEqual(bundle);
  });

  it("rejects an unconditioned 304 and malformed synchronization timestamps", async () => {
    await expect(new AuthorizedOfflineBundleTransport(new StubTransport(response(304, null))).fetch())
      .rejects.toThrow("without a cached encrypted snapshot");
    await expect(new AuthorizedOfflineBundleTransport(new StubTransport(response(304, null, { "x-synchronized-at": "not-a-time" }))).fetch(fixture()))
      .rejects.toThrow("synchronizedAt is invalid");
  });

  it("normalizes authorized retrieval failures", async () => {
    const protocol = new AuthorizedOfflineBundleTransport(new StubTransport(response(401, { error: "unauthenticated" })));
    await expect(protocol.fetch()).rejects.toEqual(new AuthorizedOfflineBundleTransportError(401, "unauthenticated"));
  });
});

class StubTransport implements AuthenticatedTransport {
  public readonly requests: PlatformHttpRequest[] = [];
  public constructor(private readonly result: PlatformHttpResponse) {}
  public async request(request: PlatformHttpRequest): Promise<PlatformHttpResponse> {
    this.requests.push(request);
    return this.result;
  }
}

function response(status: number, body: unknown, headers: Record<string, string> = {}): PlatformHttpResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async <Value,>() => body as Value,
    bytes: async () => new Uint8Array(),
    text: async () => body === null ? "" : JSON.stringify(body)
  };
}

function fixture(): EncryptedOfflineVaultBundle {
  return {
    schemaVersion: 2,
    profileId: "profile_1",
    synchronizedAt: "2026-09-01T00:00:00.000Z",
    synchronizationToken: "sync_token_1",
    cryptoProfile: {
      vaultUnlockSalt: bytesToBase64(new Uint8Array(16).fill(1)),
      wrappedUserRootKey: envelope(2),
      encryptedPersonalVaultKey: envelope(3),
      encryptionVersion: 1
    },
    personalVault: {
      vaultId: "vault_1",
      lifecycle: "ACTIVE",
      encryptedName: envelope(4),
      encryptionVersion: 1,
      accounts: []
    },
    sharedVaults: []
  };
}

function envelope(fill: number): string {
  const bytes = new Uint8Array(29).fill(fill);
  bytes[0] = 2;
  return bytesToBase64(bytes);
}
