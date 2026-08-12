import { createAuthenticatorAccountPayloadPort } from "../../../../src/modules/authenticator-account/application/account-payload";
import type { AuthenticatedTransport, PlatformHttpRequest, PlatformHttpResponse } from "../../../../src/shared/application/platform-ports";
import { base64ToBytes } from "../../../../src/shared/application/base64";
import { generateMobileTotp, MobileAuthenticatorAccountRepository } from "./mobile-authenticator-account";
import { nativeClientCrypto } from "./native-client-crypto";

const payloads = createAuthenticatorAccountPayloadPort(nativeClientCrypto);

describe("MobileAuthenticatorAccountRepository", () => {
  it("imports a TOTP URI locally and sends only context-bound ciphertext", async () => {
    const transport = new StubTransport(response(201, { id: "account_1", revision: 1 }));
    const repository = new MobileAuthenticatorAccountRepository(transport);
    const key = new Uint8Array(32).fill(9);

    const account = await repository.importTotpUri(
      { id: "vault_1", name: "Personal", type: "PERSONAL", key },
      "otpauth://totp/Example:alice%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example",
    );

    const request = transport.requests[0];
    expect(request.url).toBe("/api/vaults/vault_1/accounts");
    const requestBody = String(request.body);
    expect(requestBody).not.toContain("Example");
    expect(requestBody).not.toContain("alice");
    expect(requestBody).not.toContain("JBSWY3DPEHPK3PXP");
    const body = JSON.parse(requestBody) as { encryptedPayload: string; encryptionVersion: number };
    const decrypted = await payloads.decryptAccountConfiguration(key, base64ToBytes(body.encryptedPayload), {
      purpose: "authenticator-account",
      payloadType: "totp-configuration",
      vaultId: "vault_1",
      keyVersion: 1,
    });
    expect(decrypted).toEqual(expect.objectContaining({ issuer: "Example", accountName: "alice@example.com" }));
    decrypted.secret.fill(0);
    account.secret.fill(0);
  });

  it("preserves revision checks when deleting a Shared Vault account", async () => {
    const transport = new StubTransport(response(204, null));
    const repository = new MobileAuthenticatorAccountRepository(transport);
    await repository.deleteAccount({ id: "account_2", vaultId: "shared_1", vaultType: "SHARED", revision: 4 });
    expect(transport.requests[0]).toEqual({
      url: "/api/shared-vaults/shared_1/accounts",
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: "account_2", expectedRevision: 4 }),
      cache: "no-store",
    });
  });

  it("records Shared Vault access through the existing rate-limited audit endpoint", async () => {
    const transport = new StubTransport(response(204, null));
    const repository = new MobileAuthenticatorAccountRepository(transport);
    await repository.recordSharedVaultAccountAccess("shared_1", "account_2");
    expect(transport.requests[0]).toEqual({
      url: "/api/shared-vaults/shared_1/audit-events",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventType: "ACCOUNT_ACCESSED", accountId: "account_2" }),
      cache: "no-store",
    });
  });

  it("preserves the Shared Vault endpoint and domain type", async () => {
    const transport = new StubTransport(response(201, { id: "account_2", revision: 1 }));
    const repository = new MobileAuthenticatorAccountRepository(transport);
    const key = new Uint8Array(32).fill(7);
    const account = await repository.importTotpUri(
      { id: "shared_1", name: "Team", type: "SHARED", key },
      "otpauth://totp/Example:bob?secret=JBSWY3DPEHPK3PXP&issuer=Example",
    );

    expect(transport.requests[0].url).toBe("/api/shared-vaults/shared_1/accounts");
    expect(account.vaultType).toBe("SHARED");
    account.secret.fill(0);
  });

  it("generates the RFC 6238 code entirely offline", async () => {
    const secret = new TextEncoder().encode("12345678901234567890");
    const code = await generateMobileTotp({
      id: "account_1",
      vaultId: "vault_1",
      vaultName: "Personal",
      vaultType: "PERSONAL",
      revision: 1,
      issuer: "RFC",
      accountName: "vector",
      secret,
      algorithm: "SHA-1",
      digits: 8,
      period: 30,
    }, new Date(59_000));
    expect(code.value).toBe("94287082");
    expect(code.validUntil.toISOString()).toBe("1970-01-01T00:01:00.000Z");
    secret.fill(0);
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
    json: async <Value,>() => body as Value,
    bytes: async () => new Uint8Array(),
    text: async () => JSON.stringify(body),
  };
}
