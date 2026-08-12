"use client";

import type { CryptoPrimitivePort, PortableJsonWebKey } from "@rhasia-scret/client-vault-core";

/** Web Crypto adapter. Protocol workflows consume CryptoPrimitivePort instead of this module. */
export class BrowserCryptoPrimitives implements CryptoPrimitivePort {
  randomBytes(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0) throw new Error("Random byte length is invalid.");
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
  }

  async encryptAesGcm(request: { key: Uint8Array; nonce: Uint8Array; plaintext: Uint8Array; additionalData?: Uint8Array }): Promise<Uint8Array> {
    const key = await importAesKey(request.key, ["encrypt"]);
    return new Uint8Array(await crypto.subtle.encrypt(aesParameters(request.nonce, request.additionalData), key, request.plaintext.slice()));
  }

  async decryptAesGcm(request: { key: Uint8Array; nonce: Uint8Array; ciphertext: Uint8Array; additionalData?: Uint8Array }): Promise<Uint8Array> {
    const key = await importAesKey(request.key, ["decrypt"]);
    try {
      return new Uint8Array(await crypto.subtle.decrypt(aesParameters(request.nonce, request.additionalData), key, request.ciphertext.slice()));
    } catch {
      throw new Error("Encrypted envelope authentication failed.");
    }
  }

  async generateEcdhKeyPair(): Promise<{ publicKey: PortableJsonWebKey; privateKey: PortableJsonWebKey }> {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    if (!("privateKey" in pair) || !("publicKey" in pair)) throw new Error("Could not create ECDH keys.");
    return {
      publicKey: await crypto.subtle.exportKey("jwk", pair.publicKey) as unknown as PortableJsonWebKey,
      privateKey: await crypto.subtle.exportKey("jwk", pair.privateKey) as unknown as PortableJsonWebKey
    };
  }

  async deriveEcdhSharedKey(privateKey: PortableJsonWebKey, publicKey: PortableJsonWebKey): Promise<Uint8Array> {
    const privateCryptoKey = await crypto.subtle.importKey("jwk", privateKey as JsonWebKey, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    const publicCryptoKey = await crypto.subtle.importKey("jwk", publicKey as JsonWebKey, { name: "ECDH", namedCurve: "P-256" }, false, []);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: publicCryptoKey }, privateCryptoKey, 256));
  }

  async signHmac(algorithm: "SHA-1" | "SHA-256" | "SHA-512", keyBytes: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey("raw", keyBytes.slice(), { name: "HMAC", hash: algorithm }, false, ["sign"]);
    return new Uint8Array(await crypto.subtle.sign("HMAC", key, message.slice()));
  }
}

export const browserCryptoPrimitives = new BrowserCryptoPrimitives();

function aesParameters(nonce: Uint8Array, additionalData?: Uint8Array): AesGcmParams {
  return additionalData
    ? { name: "AES-GCM", iv: nonce.slice(), additionalData: additionalData.slice(), tagLength: 128 }
    : { name: "AES-GCM", iv: nonce.slice(), tagLength: 128 };
}

async function importAesKey(bytes: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  if (bytes.length !== 32) throw new Error("AES-256-GCM requires a 32-byte key.");
  return crypto.subtle.importKey("raw", bytes.slice(), "AES-GCM", false, usages);
}
