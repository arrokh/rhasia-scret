import { describe, expect, it } from "vitest";
import {
  HostedAuthenticatorAccountTransport,
  HostedAuthenticatorAccountTransportError,
  type AuthenticatedTransport,
  type PlatformHttpRequest,
  type PlatformHttpResponse,
} from "../src";

const ciphertext = Buffer.alloc(29, 7).toString("base64");

describe("HostedAuthenticatorAccountTransport", () => {
  it.each([
    ["PERSONAL" as const, "/api/vaults/vault_1/accounts"],
    ["SHARED" as const, "/api/shared-vaults/vault_1/accounts"],
  ])("selects the %s endpoint and returns a strict created account", async (vaultType, url) => {
    const transport = new StubTransport(response(201, { id: "account_1", revision: 1 }));
    const protocol = new HostedAuthenticatorAccountTransport(transport);
    await expect(
      protocol.create({ vaultId: "vault_1", vaultType }, { encryptedPayload: ciphertext, encryptionVersion: 1 }),
    ).resolves.toEqual({ id: "account_1", revision: 1 });
    expect(transport.requests).toEqual([
      {
        url,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ encryptedPayload: ciphertext, encryptionVersion: 1 }),
        cache: "no-store",
      },
    ]);
  });

  it("preserves revisions and the Local Vault copy source marker", async () => {
    const transport = new StubTransport(response(200, { id: "account_1", revision: 3 }));
    const protocol = new HostedAuthenticatorAccountTransport(transport);
    await protocol.update(
      { vaultId: "vault_1", vaultType: "PERSONAL" },
      { accountId: "account_1", expectedRevision: 2, encryptedPayload: ciphertext, encryptionVersion: 1 },
    );
    expect(JSON.parse(String(transport.requests[0]?.body))).toEqual({
      accountId: "account_1",
      expectedRevision: 2,
      encryptedPayload: ciphertext,
      encryptionVersion: 1,
    });

    transport.result = response(201, { id: "account_2", revision: 1 });
    await protocol.create(
      { vaultId: "vault_1", vaultType: "PERSONAL" },
      { encryptedPayload: ciphertext, encryptionVersion: 1, source: "LOCAL_VAULT_COPY" },
    );
    expect(JSON.parse(String(transport.requests[1]?.body))).toMatchObject({ source: "LOCAL_VAULT_COPY" });
  });

  it("requires exact empty-success statuses for delete and restore", async () => {
    const transport = new StubTransport(response(204, null));
    const protocol = new HostedAuthenticatorAccountTransport(transport);
    await protocol.delete(
      { vaultId: "shared_1", vaultType: "SHARED" },
      { accountId: "account_1", expectedRevision: 4 },
    );
    await protocol.restore({ vaultId: "shared_1", vaultType: "SHARED" }, { accountId: "account_1" });
    expect(transport.requests.map(({ method, body }) => [method, JSON.parse(String(body))])).toEqual([
      ["DELETE", { accountId: "account_1", expectedRevision: 4 }],
      ["PUT", { accountId: "account_1" }],
    ]);
  });

  it("rejects extra response fields and normalizes server failures", async () => {
    const protocol = new HostedAuthenticatorAccountTransport(
      new StubTransport(response(201, { id: "account_1", revision: 1, plaintext: "forbidden" })),
    );
    await expect(
      protocol.create(
        { vaultId: "vault_1", vaultType: "PERSONAL" },
        { encryptedPayload: ciphertext, encryptionVersion: 1 },
      ),
    ).rejects.toThrow("protocol value is invalid");

    const failed = new HostedAuthenticatorAccountTransport(
      new StubTransport(response(409, { error: "stale_revision" })),
    );
    await expect(
      failed.update(
        { vaultId: "vault_1", vaultType: "PERSONAL" },
        { accountId: "account_1", expectedRevision: 1, encryptedPayload: ciphertext, encryptionVersion: 1 },
      ),
    ).rejects.toEqual(new HostedAuthenticatorAccountTransportError(409, "stale_revision"));
  });

  it("does not forward unexpected runtime request fields", async () => {
    const transport = new StubTransport(response(201, { id: "account_1", revision: 1 }));
    const protocol = new HostedAuthenticatorAccountTransport(transport);
    await protocol.create({ vaultId: "vault_1", vaultType: "PERSONAL" }, {
      encryptedPayload: ciphertext,
      encryptionVersion: 1,
      extra: "plaintext",
    } as unknown as { encryptedPayload: string; encryptionVersion: 1 });
    expect(JSON.parse(String(transport.requests[0]?.body))).toEqual({
      encryptedPayload: ciphertext,
      encryptionVersion: 1,
    });
  });
});

class StubTransport implements AuthenticatedTransport {
  public readonly requests: PlatformHttpRequest[] = [];
  public constructor(public result: PlatformHttpResponse) {}
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
    text: async () => (body === null ? "" : JSON.stringify(body)),
  };
}
