import { generateTotp } from "@rhasia-scret/client-vault-core";
import { RFC6238_SHA1_VECTOR } from "@rhasia-scret/client-vault-core";
import { nativeClientCrypto } from "./native-client-crypto";
import { NativeCryptoPrimitives } from "./native-crypto-primitives";

describe("NativeCryptoPrimitives", () => {
  const primitives = new NativeCryptoPrimitives();

  it("matches a Web Crypto AES-256-GCM ciphertext and tag vector", async () => {
    const key = Uint8Array.from({ length: 32 }, (_, index) => index);
    const nonce = Uint8Array.from({ length: 12 }, (_, index) => index + 32);
    const plaintext = new TextEncoder().encode("native-web-vector");
    const additionalData = new TextEncoder().encode("context");

    const ciphertext = await primitives.encryptAesGcm({ key, nonce, plaintext, additionalData });

    expect(bytesToHex(ciphertext)).toBe("bc5bd2191afd37797f1e6fb8a47b8096a2b0b777c9dda5ea5808e955539d85ebf7");
    await expect(primitives.decryptAesGcm({ key, nonce, ciphertext, additionalData })).resolves.toEqual(plaintext);
    await expect(
      primitives.decryptAesGcm({ key, nonce, ciphertext, additionalData: new Uint8Array() }),
    ).rejects.toThrow("authentication failed");
  });

  it("matches the shared RFC 6238 SHA-1 protocol vector", async () => {
    const code = await generateTotp(
      {
        issuer: "Synthetic",
        accountName: "vector@example.test",
        secret: RFC6238_SHA1_VECTOR.secret,
        algorithm: RFC6238_SHA1_VECTOR.algorithm,
        digits: RFC6238_SHA1_VECTOR.digits,
        period: RFC6238_SHA1_VECTOR.period,
      },
      { sign: (algorithm, key, message) => primitives.signHmac(algorithm, key, message) },
      new Date(RFC6238_SHA1_VECTOR.timestampMilliseconds),
    );

    expect(code.value).toBe(RFC6238_SHA1_VECTOR.expectedCode);
  });

  it("matches the RFC 5869 HKDF-SHA-256 vector used by context-bound key wraps", async () => {
    const ikm = Uint8Array.from({ length: 22 }, () => 0x0b);
    const salt = Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c]);
    const info = Uint8Array.from([0xf0, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9]);
    const derived = await primitives.deriveHkdfSha256(ikm, salt, info, 42);

    expect(bytesToHex(derived)).toBe(
      "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865",
    );
    ikm.fill(0);
    salt.fill(0);
    info.fill(0);
    derived.fill(0);
  });

  it("uses the shared context-bound key-wrap protocol", async () => {
    const pair = await nativeClientCrypto.generateUserEncryptionKeyPair();
    const vaultKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const context = {
      purpose: "vault-key-wrap",
      payloadType: "vault-encryption-key",
      profileId: "native-profile",
      keyVersion: 1,
    } as const;
    const envelope = await nativeClientCrypto.wrapKeyForRecipientWithContext(vaultKey, pair.publicKey, context);

    await expect(
      nativeClientCrypto.unwrapKeyForRecipientWithContext(envelope, pair.privateKey, context),
    ).resolves.toEqual(vaultKey);
    await expect(
      nativeClientCrypto.unwrapKeyForRecipientWithContext(envelope, pair.privateKey, {
        ...context,
        profileId: "other-profile",
      }),
    ).rejects.toThrow("authentication failed");
    vaultKey.fill(0);
  });

  it("matches the Web Crypto P-256 JWK shared-secret format", async () => {
    const alice = {
      kty: "EC",
      crv: "P-256",
      x: "axfR8uEsQkf4vOblY6RA8ncDfYEt6zOg9KE5RdiYwpY",
      y: "T-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU",
      d: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE",
    };
    const bob = {
      kty: "EC",
      crv: "P-256",
      x: "fPJ7GI0DT36KUjgDBLUaw8CJaeJ38hs1pgtI_EdmmXg",
      y: "B3dVENuO0EApPZrGn3Qw27p9reY86YIpngS3nSJ4c9E",
    };

    const shared = await primitives.deriveEcdhSharedKey(alice, bob);

    expect(bytesToHex(shared)).toBe("7cf27b188d034f7e8a52380304b51ac3c08969e277f21b35a60b48fc47669978");
    shared.fill(0);
  });

  it("derives the same P-256 ECDH secret from either side", async () => {
    const alice = await primitives.generateEcdhKeyPair();
    const bob = await primitives.generateEcdhKeyPair();

    const aliceSecret = await primitives.deriveEcdhSharedKey(alice.privateKey, bob.publicKey);
    const bobSecret = await primitives.deriveEcdhSharedKey(bob.privateKey, alice.publicKey);

    expect(aliceSecret).toHaveLength(32);
    expect(aliceSecret).toEqual(bobSecret);
    aliceSecret.fill(0);
    bobSecret.fill(0);
  });

  it("rejects malformed P-256 key material", async () => {
    const pair = await primitives.generateEcdhKeyPair();

    await expect(primitives.deriveEcdhSharedKey(pair.privateKey, { ...pair.publicKey, x: "AQ" })).rejects.toThrow(
      "invalid",
    );
  });
});

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
