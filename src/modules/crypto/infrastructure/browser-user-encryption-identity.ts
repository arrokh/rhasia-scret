"use client";

import { decryptPayloadWithContext, encryptPayloadWithContext, generateUserEncryptionKeyPair, type CryptoEnvelopeContext, type EncryptedEnvelope } from "./browser-crypto-envelope";

export type EncryptedUserEncryptionIdentity = {
  publicKey: JsonWebKey;
  encryptedPrivateKey: EncryptedEnvelope;
};

export async function createUserEncryptionIdentity(userRootKey: Uint8Array): Promise<EncryptedUserEncryptionIdentity> {
  const pair = await generateUserEncryptionKeyPair();
  const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const privateKey = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const plaintext = new TextEncoder().encode(JSON.stringify(privateKey));
  try {
    return {
      publicKey,
      encryptedPrivateKey: await encryptPayloadWithContext(userRootKey, plaintext, userEncryptionIdentityContext())
    };
  } finally {
    plaintext.fill(0);
  }
}

export async function recoverUserEncryptionPrivateKey(
  userRootKey: Uint8Array,
  encryptedPrivateKey: EncryptedEnvelope
): Promise<JsonWebKey> {
  const plaintext = await decryptPayloadWithContext(userRootKey, encryptedPrivateKey, userEncryptionIdentityContext());
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext));
    if (!parsed || typeof parsed !== "object") throw new Error("Encrypted private key is invalid.");
    return parsed as JsonWebKey;
  } finally {
    plaintext.fill(0);
  }
}

function userEncryptionIdentityContext(): CryptoEnvelopeContext {
  return { purpose: "user-encryption-private-key", payloadType: "user-encryption-private-key", keyVersion: 1 };
}
