import { describe, expect, it } from "vitest";
import {
  AuthorizedWorkspaceTransport,
  AuthorizedWorkspaceTransportError,
  type AuthenticatedTransport,
  type PlatformHttpRequest,
  type PlatformHttpResponse,
} from "../src/index";

const envelope = Buffer.from([2, ...Array<number>(28).fill(7)]).toString("base64");
const salt = Buffer.alloc(16, 8).toString("base64");
const responseBody = {
  responseVersion: 1,
  workspaceSynchronizationToken: "workspace-1",
  synchronizedAt: "2026-01-01T00:00:00.000Z",
  personalSnapshot: {
    schemaVersion: 3,
    profileId: "profile-1",
    synchronizedAt: "2026-01-01T00:00:00.000Z",
    synchronizationToken: "personal-1",
    cryptoProfile: {
      vaultUnlockSalt: salt,
      wrappedUserRootKey: envelope,
      encryptedPersonalVaultKey: envelope,
      encryptionVersion: 1,
    },
    personalVault: {
      vaultId: "personal-1-vault",
      lifecycle: "ACTIVE",
      encryptedName: envelope,
      encryptionVersion: 1,
      accounts: [],
    },
  },
  sharedVaults: [],
};

describe("AuthorizedWorkspaceTransport", () => {
  it("requests a fresh no-store workspace and strictly parses the response", async () => {
    const transport = new StubTransport(response(200, responseBody));
    await expect(new AuthorizedWorkspaceTransport(transport).fetch()).resolves.toEqual(responseBody);
    expect(transport.requests).toEqual([{ url: "/v1/sync/workspace-bundle", method: "GET", cache: "no-store" }]);
  });

  it("passes cancellation to the transport and rejects a late response", async () => {
    const transport = new StubTransport(response(200, responseBody));
    let aborted = false;
    const signal = {
      get aborted() {
        return aborted;
      },
      subscribe: () => () => undefined,
    };
    const pending = new AuthorizedWorkspaceTransport(transport).fetch(signal);
    aborted = true;

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(transport.requests[0]?.signal).toBe(signal);
  });

  it("normalizes server errors without retaining response content", async () => {
    const transport = new StubTransport(response(403, { error: "inactive_user", secret: "must-not-leak" }));
    await expect(new AuthorizedWorkspaceTransport(transport).fetch()).rejects.toEqual(
      new AuthorizedWorkspaceTransportError(403, "request_failed"),
    );
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

function response(status: number, body: unknown): PlatformHttpResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    json: async <Value>() => body as Value,
    bytes: async () => new Uint8Array(),
    text: async () => JSON.stringify(body),
  };
}
