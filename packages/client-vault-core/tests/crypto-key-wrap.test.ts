import { describe, expect, it } from "vitest";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  createClientCryptoPort,
  createUserEncryptionIdentityWithCrypto,
  recoverUserEncryptionPrivateKeyWithCrypto,
  rotateUserEncryptionIdentityWithCrypto,
  rotateVaultKeyWithCrypto,
  type CryptoPrimitivePort,
  type PortableEcdhKeyPair,
  type PortableJsonWebKey,
} from "../src/index";

describe("client crypto key-wrap protocol", () => {
  it("wraps and unwraps context-bound keys while rejecting context substitution", async () => {
    const crypto = createClientCryptoPort(new FakeCryptoPrimitives());
    const pair = await crypto.generateUserEncryptionKeyPair();
    const vaultKey = Uint8Array.from({ length: 32 }, (_, index) => index);
    const context = { purpose: "vault-key-wrap", payloadType: "vault-encryption-key", vaultId: "vault-1", keyVersion: 1 } as const;
    const envelope = await crypto.wrapKeyForRecipientWithContext(vaultKey, pair.publicKey, context);
    const serialized = crypto.serializeKeyWrapEnvelope(envelope);

    await expect(crypto.unwrapKeyForRecipientWithContext(crypto.deserializeKeyWrapEnvelope(serialized), pair.privateKey, context)).resolves.toEqual(vaultKey);
    await expect(crypto.unwrapKeyForRecipientWithContext(envelope, pair.privateKey, { ...context, vaultId: "vault-2" })).rejects.toThrow("authentication failed");
    vaultKey.fill(0);
  });

  it("keeps legacy key-wrap compatibility behind the explicit context-free API", async () => {
    const crypto = createClientCryptoPort(new FakeCryptoPrimitives());
    const pair = await crypto.generateUserEncryptionKeyPair();
    const vaultKey = Uint8Array.from({ length: 32 }, (_, index) => 31 - index);
    const envelope = await crypto.wrapKeyForRecipient(vaultKey, pair.publicKey);

    expect(envelope.version).toBe(1);
    await expect(crypto.unwrapKeyForRecipient(envelope, pair.privateKey)).resolves.toEqual(vaultKey);
    expect(() => crypto.unwrapKeyForRecipientWithContext(envelope, pair.privateKey, {
      purpose: "vault-key-wrap",
      payloadType: "vault-encryption-key",
      keyVersion: 1,
    })).toThrow("explicit migration");
    vaultKey.fill(0);
  });

  it("creates, recovers, and rotates a user encryption identity through the shared protocol", async () => {
    const crypto = createClientCryptoPort(new FakeCryptoPrimitives());
    const rootKey = new Uint8Array(32).fill(5);
    const vaultKey = new Uint8Array(32).fill(6);
    const context = { purpose: "vault-key-wrap", payloadType: "vault-encryption-key", keyVersion: 1 } as const;
    const original = await createUserEncryptionIdentityWithCrypto(rootKey, crypto);
    const originalPrivateKey = await recoverUserEncryptionPrivateKeyWithCrypto(rootKey, original.encryptedPrivateKey, crypto);
    const wrapped = crypto.serializeKeyWrapEnvelope(await crypto.wrapKeyForRecipientWithContext(vaultKey, original.publicKey, context));
    const rotated = await rotateUserEncryptionIdentityWithCrypto(rootKey, crypto.serializeEncryptedEnvelope(original.encryptedPrivateKey), [wrapped], crypto);
    const rotatedPrivateKey = await recoverUserEncryptionPrivateKeyWithCrypto(rootKey, rotated.identity.encryptedPrivateKey, crypto);

    expect(originalPrivateKey.d).toBeTypeOf("string");
    await expect(crypto.unwrapKeyForRecipientWithContext(crypto.deserializeKeyWrapEnvelope(rotated.wrappedVaultKeys[0]!), rotatedPrivateKey, context)).resolves.toEqual(vaultKey);
    rootKey.fill(0);
    vaultKey.fill(0);
  });

  it("rotates Vault Encryption Key payloads while clearing intermediate plaintext", async () => {
    const crypto = createClientCryptoPort(new FakeCryptoPrimitives());
    const oldKey = new Uint8Array(32).fill(7);
    const name = new TextEncoder().encode("encrypted-name-placeholder");
    const account = new TextEncoder().encode("encrypted-account-placeholder");
    const nameContext = { purpose: "vault-name", payloadType: "vault-name", vaultId: "vault-1", keyVersion: 1 } as const;
    const accountContext = { purpose: "authenticator-account", payloadType: "totp-configuration", vaultId: "vault-1", accountId: "account-1", keyVersion: 1 } as const;
    const encryptedName = crypto.serializeEncryptedEnvelope(await crypto.encryptPayloadWithContext(oldKey, name, nameContext));
    const encryptedAccount = crypto.serializeEncryptedEnvelope(await crypto.encryptPayloadWithContext(oldKey, account, accountContext));
    const rotated = await rotateVaultKeyWithCrypto(oldKey, { encryptedName, encryptedAccounts: [encryptedAccount], vaultId: "vault-1", accountIds: ["account-1"] }, crypto);

    await expect(crypto.decryptPayloadWithContext(rotated.vaultKey, crypto.deserializeEncryptedEnvelope(rotated.encryptedName), nameContext)).resolves.toEqual(name);
    await expect(crypto.decryptPayloadWithContext(rotated.vaultKey, crypto.deserializeEncryptedEnvelope(rotated.encryptedAccounts[0]!), accountContext)).resolves.toEqual(account);
    rotated.vaultKey.fill(0);
    oldKey.fill(0);
    name.fill(0);
    account.fill(0);
  });

  it("strictly parses key-wrap envelopes and key material", async () => {
    const crypto = createClientCryptoPort(new FakeCryptoPrimitives());
    const pair = await crypto.generateUserEncryptionKeyPair();
    const envelope = await crypto.wrapKeyForRecipientWithContext(new Uint8Array(32), pair.publicKey, {
      purpose: "vault-key-wrap",
      payloadType: "vault-encryption-key",
      keyVersion: 1,
    });
    const parsed = JSON.parse(new TextDecoder().decode(crypto.serializeKeyWrapEnvelope(envelope))) as Record<string, unknown>;
    parsed.unexpected = true;
    expect(() => crypto.deserializeKeyWrapEnvelope(new TextEncoder().encode(JSON.stringify(parsed)))).toThrow("invalid");
    await expect(crypto.wrapKeyForRecipientWithContext(new Uint8Array(32), { ...pair.publicKey, x: "AQ" }, {
      purpose: "vault-key-wrap",
      payloadType: "vault-encryption-key",
      keyVersion: 1,
    })).rejects.toThrow("ECDH");
    await expect(crypto.unwrapKeyForRecipientWithContext(envelope, { ...pair.privateKey, d: "AQ" }, {
      purpose: "vault-key-wrap",
      payloadType: "vault-encryption-key",
      keyVersion: 1,
    })).rejects.toThrow("ECDH");
    await expect(crypto.wrapKeyForRecipientWithContext(new Uint8Array(31), pair.publicKey, {
      purpose: "vault-key-wrap",
      payloadType: "vault-encryption-key",
      keyVersion: 1,
    })).rejects.toThrow("32-byte key");
  });
});

class FakeCryptoPrimitives implements CryptoPrimitivePort {
  private counter = 1;

  randomBytes(length: number): Uint8Array {
    return Uint8Array.from({ length }, () => this.counter++ & 0xff);
  }

  async encryptAesGcm(request: { key: Uint8Array; nonce: Uint8Array; plaintext: Uint8Array; additionalData?: Uint8Array }): Promise<Uint8Array> {
    const ciphertext = new Uint8Array(request.plaintext.length + 16);
    for (let index = 0; index < request.plaintext.length; index += 1) {
      ciphertext[index] = request.plaintext[index] ^ request.key[index % request.key.length] ^ request.nonce[index % request.nonce.length];
    }
    ciphertext.fill(authTag(request.key, request.nonce, ciphertext.subarray(0, request.plaintext.length), request.additionalData), request.plaintext.length);
    return ciphertext;
  }

  async decryptAesGcm(request: { key: Uint8Array; nonce: Uint8Array; ciphertext: Uint8Array; additionalData?: Uint8Array }): Promise<Uint8Array> {
    if (request.ciphertext.length < 16) throw new Error("Encrypted envelope authentication failed.");
    const encrypted = request.ciphertext.subarray(0, request.ciphertext.length - 16);
    const expected = authTag(request.key, request.nonce, encrypted, request.additionalData);
    if (!request.ciphertext.subarray(encrypted.length).every((value) => value === expected)) throw new Error("Encrypted envelope authentication failed.");
    return Uint8Array.from(encrypted, (value, index) => value ^ request.key[index % request.key.length] ^ request.nonce[index % request.nonce.length]);
  }

  async generateEcdhKeyPair(): Promise<PortableEcdhKeyPair> {
    const privateBytes = this.randomBytes(32);
    const publicBytes = this.randomBytes(32);
    const publicKey: PortableJsonWebKey = { kty: "EC", crv: "P-256", x: bytesToBase64Url(privateBytes), y: bytesToBase64Url(publicBytes) };
    privateBytes.fill(0);
    publicBytes.fill(0);
    return { publicKey, privateKey: { ...publicKey, d: publicKey.x } };
  }

  async deriveEcdhSharedKey(privateKey: PortableJsonWebKey, publicKey: PortableJsonWebKey): Promise<Uint8Array> {
    const left = base64UrlToBytes(String(privateKey.d));
    const right = base64UrlToBytes(String(publicKey.x));
    const result = Uint8Array.from(left, (value, index) => value ^ right[index]);
    left.fill(0);
    right.fill(0);
    return result;
  }

  async deriveHkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
    return Uint8Array.from({ length }, (_, index) => ikm[index % ikm.length] ^ (salt[index % Math.max(salt.length, 1)] ?? 0) ^ (info[index % Math.max(info.length, 1)] ?? 0));
  }

  async signHmac(): Promise<Uint8Array> {
    return new Uint8Array(32);
  }
}

function authTag(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array, additionalData?: Uint8Array): number {
  let value = 0;
  for (const bytes of [key, nonce, ciphertext, additionalData ?? new Uint8Array()]) {
    for (const byte of bytes) value = (value + byte) & 0xff;
  }
  return value;
}
