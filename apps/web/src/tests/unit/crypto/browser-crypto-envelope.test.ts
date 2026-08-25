import { describe, expect, it } from "vitest";
import {
  decryptPayload,
  decryptPayloadWithContext,
  deserializeEncryptedEnvelope,
  encryptPayload,
  encryptPayloadWithContext,
  generateSymmetricKey,
  generateUserEncryptionKeyPair,
  migrateLegacyEncryptedPayload,
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

  it("binds version 2 ciphertext to its semantic context and migrates legacy bytes explicitly", async () => {
    const key = generateSymmetricKey();
    const plaintext = new TextEncoder().encode("context-bound content");
    const context = { purpose: "authenticator-account", payloadType: "totp-configuration", vaultId: "vault-1", accountId: "account-1", keyVersion: 1 } as const;
    const envelope = await encryptPayloadWithContext(key, plaintext, context);
    expect(envelope.version).toBe(2);
    await expect(decryptPayloadWithContext(key, envelope, { ...context, vaultId: "vault-2" })).rejects.toThrow("authentication failed");
    await expect(decryptPayloadWithContext(key, envelope, context)).resolves.toEqual(plaintext);
    const legacy = await encryptPayload(key, plaintext);
    const migrated = await migrateLegacyEncryptedPayload(key, new Uint8Array([1, ...legacy.nonce, ...legacy.ciphertext]), context);
    await expect(decryptPayloadWithContext(key, deserializeEncryptedEnvelope(migrated), context)).resolves.toEqual(plaintext);
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
