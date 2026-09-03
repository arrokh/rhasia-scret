import type { ClientCryptoPort, PortableJsonWebKey } from "./crypto-ports";
import type { CryptoEnvelopeContext, EncryptedEnvelope } from "./encrypted-envelope-types";

export type EncryptedUserEncryptionIdentity = {
  publicKey: PortableJsonWebKey;
  encryptedPrivateKey: EncryptedEnvelope;
};

export async function createUserEncryptionIdentityWithCrypto(
  userRootKey: Uint8Array,
  crypto: ClientCryptoPort,
): Promise<EncryptedUserEncryptionIdentity> {
  const pair = await crypto.generateUserEncryptionKeyPair();
  const plaintext = new TextEncoder().encode(JSON.stringify(pair.privateKey));
  try {
    return {
      publicKey: { ...pair.publicKey },
      encryptedPrivateKey: await crypto.encryptPayloadWithContext(userRootKey, plaintext, userEncryptionIdentityContext()),
    };
  } finally {
    plaintext.fill(0);
  }
}

export async function recoverUserEncryptionPrivateKeyWithCrypto(
  userRootKey: Uint8Array,
  encryptedPrivateKey: EncryptedEnvelope,
  crypto: ClientCryptoPort,
): Promise<PortableJsonWebKey> {
  const plaintext = await crypto.decryptPayloadWithContext(userRootKey, encryptedPrivateKey, userEncryptionIdentityContext());
  try {
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
    } catch {
      throw new Error("Encrypted private key is invalid.");
    }
    if (!isPrivateKey(parsed)) throw new Error("Encrypted private key is invalid.");
    return parsed;
  } finally {
    plaintext.fill(0);
  }
}

export function userEncryptionIdentityContext(): CryptoEnvelopeContext {
  return { purpose: "user-encryption-private-key", payloadType: "user-encryption-private-key", keyVersion: 1 };
}

function isPrivateKey(value: unknown): value is PortableJsonWebKey {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (value as Record<string, unknown>).kty === "EC"
    && (value as Record<string, unknown>).crv === "P-256"
    && typeof (value as Record<string, unknown>).x === "string"
    && typeof (value as Record<string, unknown>).y === "string"
    && typeof (value as Record<string, unknown>).d === "string";
}
