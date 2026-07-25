import { describe, expect, it } from "vitest";
import {
  decryptPayload,
  encryptPayload,
  generateSymmetricKey,
  generateUserEncryptionKeyPair,
  unwrapKeyForRecipient,
  wrapKeyForRecipient
} from "@/modules/crypto/infrastructure/browser-crypto-envelope";

describe("browser crypto envelopes", () => {
  it("encrypts and authenticates a payload with AES-256-GCM", async () => {
    const key = generateSymmetricKey();
    const plaintext = new TextEncoder().encode("private vault content");
    const envelope = await encryptPayload(key, plaintext, new TextEncoder().encode("vault-1"));
    await expect(decryptPayload(key, envelope, new TextEncoder().encode("vault-1"))).resolves.toEqual(plaintext);
    await expect(decryptPayload(key, envelope, new TextEncoder().encode("vault-2"))).rejects.toThrow("authentication failed");
  });

  it("wraps a vault key through P-256 ECDH and HKDF", async () => {
    const pair = await generateUserEncryptionKeyPair();
    const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const privateKey = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const vaultKey = generateSymmetricKey();
    const envelope = await wrapKeyForRecipient(vaultKey, publicKey);
    await expect(unwrapKeyForRecipient(envelope, privateKey)).resolves.toEqual(vaultKey);
  });
});
