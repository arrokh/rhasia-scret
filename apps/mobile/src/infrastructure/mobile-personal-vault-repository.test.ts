import type {
  AuthenticatedTransport,
  PlatformHttpRequest,
  PlatformHttpResponse,
} from "@rhasia-scret/client-vault-core";
import { bytesToBase64 } from "@rhasia-scret/client-vault-core";
import { MobilePersonalVaultRepository } from "./mobile-personal-vault-repository";

class StubTransport implements AuthenticatedTransport {
  public requests: PlatformHttpRequest[] = [];

  public constructor(private readonly responses: PlatformHttpResponse[]) {}

  public async request(request: PlatformHttpRequest): Promise<PlatformHttpResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (!response) throw new Error("Missing stub response.");
    return response;
  }
}

describe("MobilePersonalVaultRepository", () => {
  it("loads the locale-independent Personal Vault lifecycle", async () => {
    const transport = new StubTransport([jsonResponse(200, { id: "vault-1", lifecycle: "UNINITIALIZED" })]);
    const repository = new MobilePersonalVaultRepository(transport);

    await expect(repository.load()).resolves.toEqual({ id: "vault-1", lifecycle: "UNINITIALIZED" });
    expect(transport.requests).toEqual([{ url: "/api/personal-vault", method: "GET", cache: "no-store" }]);
  });

  it("loads only encrypted crypto-profile material", async () => {
    const salt = Uint8Array.from({ length: 16 }, (_, index) => index);
    const wrapped = Uint8Array.from({ length: 30 }, (_, index) => index + 1);
    const encryptedVaultKey = Uint8Array.from({ length: 30 }, (_, index) => index + 31);
    const transport = new StubTransport([jsonResponse(200, {
      vaultUnlockSalt: bytesToBase64(salt),
      wrappedUserRootKey: bytesToBase64(wrapped),
      encryptedPersonalVaultKey: bytesToBase64(encryptedVaultKey),
      encryptionVersion: 1,
      userEncryptionPublicKey: { kty: "EC" },
    })]);
    const repository = new MobilePersonalVaultRepository(transport);

    await expect(repository.loadCryptoProfile()).resolves.toEqual({
      vaultUnlockSalt: salt,
      wrappedUserRootKey: wrapped,
      encryptedPersonalVaultKey: encryptedVaultKey,
      encryptionVersion: 1,
    });
    expect(transport.requests[0]).toEqual({ url: "/api/user-crypto-profile", method: "GET", cache: "no-store" });
  });

  it("sends only protocol ciphertext and salt during initialization", async () => {
    const transport = new StubTransport([emptyResponse(204)]);
    const repository = new MobilePersonalVaultRepository(transport);

    await repository.initialize({
      vaultUnlockSalt: Uint8Array.from({ length: 16 }, (_, index) => index),
      wrappedUserRootKey: Uint8Array.of(2, 3, 4),
      encryptedPersonalVaultKey: Uint8Array.of(5, 6, 7),
      encryptedVaultName: Uint8Array.of(8, 9, 10),
      encryptionVersion: 1,
    });

    expect(transport.requests[0]).toMatchObject({
      url: "/api/personal-vault/initialize",
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(JSON.parse(String(transport.requests[0].body))).toEqual({
      vaultUnlockSalt: "AAECAwQFBgcICQoLDA0ODw==",
      wrappedUserRootKey: "AgME",
      encryptedPersonalVaultKey: "BQYH",
      encryptedVaultName: "CAkK",
      encryptionVersion: 1,
    });
  });

  it("rejects malformed lifecycle responses", async () => {
    const repository = new MobilePersonalVaultRepository(new StubTransport([jsonResponse(200, { id: "vault-1", lifecycle: "DELETED" })]));

    await expect(repository.load()).rejects.toMatchObject({ code: "invalid_response" });
  });
});

function jsonResponse(status: number, body: unknown): PlatformHttpResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers({ "content-type": "application/json" }),
    json: async <Value>() => body as Value,
    bytes: async () => new Uint8Array(),
    text: async () => JSON.stringify(body),
  };
}

function emptyResponse(status: number): PlatformHttpResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(),
    json: async <Value>() => undefined as Value,
    bytes: async () => new Uint8Array(),
    text: async () => "",
  };
}
