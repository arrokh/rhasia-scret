import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("@/shared/infrastructure/browser-api-client", () => ({
  browserAuthenticatedTransport: { request: mocks.request },
}));

import { createUserEncryptionIdentityWithCrypto } from "@rhasia-scret/client-vault-core";
import { recover } from "@/modules/crypto/migration";
import { browserClientCryptoPort } from "@/modules/crypto/infrastructure/browser-client-crypto-port";

describe("browser User Encryption Private Key recovery and migration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.request.mockResolvedValue({ status: 204 });
  });

  it("migrates a valid legacy envelope and persists its opaque v2 replacement", async () => {
    const userRootKey = new Uint8Array(32).fill(53);
    const keyPair = await browserClientCryptoPort.generateUserEncryptionKeyPair();
    const originalPublicKey = { ...keyPair.publicKey };
    const plaintext = new TextEncoder().encode(JSON.stringify(keyPair.privateKey));
    const legacyEnvelope = await browserClientCryptoPort.encryptPayload(userRootKey, plaintext);
    const legacyCiphertext = browserClientCryptoPort.serializeEncryptedEnvelope(legacyEnvelope);

    const recoveredPrivateKey = await recover(userRootKey, legacyCiphertext, keyPair.publicKey, 1);

    expect(recoveredPrivateKey).toEqual(keyPair.privateKey);
    expect(keyPair.publicKey).toEqual(originalPublicKey);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/v1/user-encryption-identity/migration",
        method: "POST",
        cache: "no-store",
      }),
    );

    clearPrivateKey(recoveredPrivateKey);
    clearPrivateKey(keyPair.privateKey);
    userRootKey.fill(0);
    plaintext.fill(0);
    legacyEnvelope.nonce.fill(0);
    legacyEnvelope.ciphertext.fill(0);
    legacyCiphertext.fill(0);
  });

  it("recovers a v2 identity without invoking the migration transport", async () => {
    const userRootKey = new Uint8Array(32).fill(71);
    const identity = await createUserEncryptionIdentityWithCrypto(userRootKey, browserClientCryptoPort);
    const encryptedPrivateKey = browserClientCryptoPort.serializeEncryptedEnvelope(identity.encryptedPrivateKey);

    const recoveredPrivateKey = await recover(userRootKey, encryptedPrivateKey, identity.publicKey, 1);

    expect(recoveredPrivateKey).toMatchObject({
      kty: "EC",
      crv: "P-256",
      x: identity.publicKey.x,
      y: identity.publicKey.y,
    });
    expect(mocks.request).not.toHaveBeenCalled();
    clearPrivateKey(recoveredPrivateKey);
    userRootKey.fill(0);
    identity.encryptedPrivateKey.nonce.fill(0);
    identity.encryptedPrivateKey.ciphertext.fill(0);
    encryptedPrivateKey.fill(0);
  });
});

function clearPrivateKey(privateKey: Record<string, unknown>): void {
  Reflect.set(privateKey, "x", "");
  Reflect.set(privateKey, "y", "");
  Reflect.set(privateKey, "d", "");
}
