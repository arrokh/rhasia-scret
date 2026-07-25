"use client";

import { decryptPayload, encryptPayload, generateUserEncryptionKeyPair, type EncryptedEnvelope } from "./browser-crypto-envelope";

export type EncryptedUserEncryptionIdentity = {
  publicKey: JsonWebKey;
  encryptedPrivateKey: EncryptedEnvelope;
};

export async function createUserEncryptionIdentity(userRootKey: Uint8Array): Promise<EncryptedUserEncryptionIdentity> {
  const pair = await generateUserEncryptionKeyPair();
  const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const privateKey = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return {
    publicKey,
    encryptedPrivateKey: await encryptPayload(userRootKey, new TextEncoder().encode(JSON.stringify(privateKey)))
  };
}

export async function recoverUserEncryptionPrivateKey(
  userRootKey: Uint8Array,
  encryptedPrivateKey: EncryptedEnvelope
): Promise<JsonWebKey> {
  const plaintext = await decryptPayload(userRootKey, encryptedPrivateKey);
  const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext));
  if (!parsed || typeof parsed !== "object") throw new Error("Encrypted private key is invalid.");
  return parsed as JsonWebKey;
}
