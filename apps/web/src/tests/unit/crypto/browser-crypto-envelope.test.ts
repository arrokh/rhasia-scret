import { describe, expect, it } from "vitest";
import { browserSha256Digest } from "@/modules/crypto/infrastructure/browser-sha256-digest";
import {
  decryptPayload,
  decryptPayloadWithContext,
  encryptPayload,
  encryptPayloadWithContext,
  generateSymmetricKey,
  generateUserEncryptionKeyPair,
  serializeKeyWrapEnvelope,
  deserializeKeyWrapEnvelope,
  unwrapKeyForRecipient,
  unwrapKeyForRecipientWithContext,
  wrapKeyForRecipient,
  wrapKeyForRecipientWithContext,
} from "@/modules/crypto/infrastructure/browser-crypto-envelope";

describe("browser crypto envelopes", () => {
  it("computes a SHA-256 ciphertext fingerprint", async () => {
    const input = new TextEncoder().encode("abc");
    const digest = await browserSha256Digest.digestSha256(input);

    expect(bytesToHex(digest)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    input.fill(0);
    digest.fill(0);
  });

  it("encrypts and authenticates a payload with AES-256-GCM", async () => {
    const key = generateSymmetricKey();
    const plaintext = new TextEncoder().encode("private vault content");
    const envelope = await encryptPayload(key, plaintext, new TextEncoder().encode("vault-1"));
    await expect(decryptPayload(key, envelope, new TextEncoder().encode("vault-1"))).resolves.toEqual(plaintext);
    await expect(decryptPayload(key, envelope, new TextEncoder().encode("vault-2"))).rejects.toThrow(
      "authentication failed",
    );
  });

  it("binds version 2 ciphertext to its semantic context and rejects v1 contextual reads", async () => {
    const key = generateSymmetricKey();
    const plaintext = new TextEncoder().encode("context-bound content");
    const context = {
      purpose: "authenticator-account",
      payloadType: "totp-configuration",
      vaultId: "vault-1",
      accountId: "account-1",
      keyVersion: 1,
    } as const;
    const envelope = await encryptPayloadWithContext(key, plaintext, context);
    expect(envelope.version).toBe(2);
    await expect(decryptPayloadWithContext(key, envelope, { ...context, vaultId: "vault-2" })).rejects.toThrow(
      "authentication failed",
    );
    await expect(decryptPayloadWithContext(key, envelope, context)).resolves.toEqual(plaintext);
    const legacy = await encryptPayload(key, plaintext);
    expect(() => decryptPayloadWithContext(key, legacy, context)).toThrow(
      "Legacy envelope requires an explicit migration before use.",
    );
  });

  it("wraps a vault key through P-256 ECDH and HKDF", async () => {
    const pair = await generateUserEncryptionKeyPair();
    const vaultKey = generateSymmetricKey();
    const context = {
      purpose: "vault-key-wrap",
      payloadType: "vault-encryption-key",
      vaultId: "vault-1",
      keyVersion: 1,
    } as const;
    const envelope = await wrapKeyForRecipientWithContext(vaultKey, pair.publicKey, context);
    const restored = deserializeKeyWrapEnvelope(serializeKeyWrapEnvelope(envelope));
    await expect(unwrapKeyForRecipientWithContext(restored, pair.privateKey, context)).resolves.toEqual(vaultKey);
    await expect(
      unwrapKeyForRecipientWithContext(restored, pair.privateKey, { ...context, vaultId: "vault-2" }),
    ).rejects.toThrow("authentication failed");

    const legacy = await wrapKeyForRecipient(vaultKey, pair.publicKey);
    await expect(unwrapKeyForRecipient(legacy, pair.privateKey)).resolves.toEqual(vaultKey);
  });
});

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
