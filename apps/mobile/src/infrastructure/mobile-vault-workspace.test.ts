import type { EncryptedOfflineVaultBundle } from "../../../../src/modules/sync/domain/offline-vault-bundle";
import type { AuthenticatedTransport, PlatformHttpRequest, PlatformHttpResponse } from "../../../../src/shared/application/platform-ports";
import { bytesToBase64 } from "../../../../src/shared/application/base64";
import { createMobileVaultWorkspacePorts } from "./mobile-vault-workspace";

jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: {
    fetch: async () => ({ isConnected: true, isInternetReachable: true }),
    addEventListener: () => () => undefined,
  },
}));

describe("mobile Vault workspace transport", () => {
  it("uses bearer transport and reuses an unchanged encrypted snapshot without mutation replay", async () => {
    const cached = fixture();
    const transport = new StubTransport(response(304, null, { "x-synchronized-at": "2026-08-11T23:00:00.000Z" }));
    const ports = createMobileVaultWorkspacePorts(transport);

    const bundle = await ports.data.fetchAuthorizedOfflineBundle(cached);

    expect(bundle).toEqual({ ...cached, synchronizedAt: "2026-08-11T23:00:00.000Z" });
    expect(transport.requests).toEqual([{
      url: "/api/sync/offline-bundle",
      method: "GET",
      headers: { "if-none-match": '"sync-token-1"' },
      cache: "no-store",
    }]);
  });

  it("fails closed on malformed bundle responses", async () => {
    const ports = createMobileVaultWorkspacePorts(new StubTransport(response(200, { plaintextSecret: "forbidden" })));
    await expect(ports.data.fetchAuthorizedOfflineBundle(null)).rejects.toThrow("Invalid encrypted offline bundle");
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
    text: async () => JSON.stringify(body),
  };
}

function fixture(): EncryptedOfflineVaultBundle {
  return {
    schemaVersion: 2,
    profileId: "profile_1",
    synchronizedAt: "2026-08-11T22:00:00.000Z",
    synchronizationToken: "sync-token-1",
    cryptoProfile: {
      vaultUnlockSalt: bytesToBase64(new Uint8Array(16).fill(1)),
      wrappedUserRootKey: envelope(2),
      encryptedPersonalVaultKey: envelope(3),
      encryptionVersion: 1,
    },
    personalVault: {
      vaultId: "vault_1",
      lifecycle: "ACTIVE",
      encryptedName: envelope(4),
      encryptionVersion: 1,
      accounts: [],
    },
    sharedVaults: [],
  };
}

function envelope(fill: number): string {
  const bytes = new Uint8Array(29).fill(fill);
  bytes[0] = 2;
  return bytesToBase64(bytes);
}
