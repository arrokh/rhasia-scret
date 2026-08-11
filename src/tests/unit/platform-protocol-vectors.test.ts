import { describe, expect, it } from "vitest";
import { ARGON2ID_PROTOCOL_VECTOR, RFC6238_SHA1_VECTOR } from "@/modules/crypto/application/protocol-test-vectors";
import { createEncryptedVaultArchive, decryptPayloadWithContext, deriveVaultUnlockKey, encryptPayloadWithContext, generateSymmetricKey, generateUserEncryptionKeyPair, openEncryptedVaultExport, unwrapKeyForRecipientWithContext, wrapKeyForRecipientWithContext } from "@/modules/crypto";
import { BrowserHmacGenerator } from "@/modules/otp-runtime/infrastructure/browser-hmac-generator";
import { generateTotp } from "@/modules/otp-runtime/application/generate-totp";
import { createSecureShareLinkMaterial, redeemSecureShareLinkMaterial } from "@/modules/vault-membership";

describe("cross-platform protocol vectors", () => {
  it("keeps Argon2id and RFC 6238 known answers stable", async () => {
    const derived = await deriveVaultUnlockKey(ARGON2ID_PROTOCOL_VECTOR.secret, ARGON2ID_PROTOCOL_VECTOR.salt);
    expect(toHex(derived)).toBe(ARGON2ID_PROTOCOL_VECTOR.expectedHex);
    derived.fill(0);

    const configuration = {
      issuer: "Vector Issuer",
      accountName: "vector@example.test",
      secret: RFC6238_SHA1_VECTOR.secret.slice(),
      algorithm: RFC6238_SHA1_VECTOR.algorithm,
      digits: RFC6238_SHA1_VECTOR.digits,
      period: RFC6238_SHA1_VECTOR.period
    } as const;
    const code = await generateTotp(configuration, new BrowserHmacGenerator(), new Date(RFC6238_SHA1_VECTOR.timestampMilliseconds));
    expect(code.value).toBe(RFC6238_SHA1_VECTOR.expectedCode);
  });

  it("keeps context-bound encryption, archives, and Secure Share Link material portable", async () => {
    const key = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const context = { purpose: "platform-vector", payloadType: "synthetic", profileId: "profile-vector", keyVersion: 1 } as const;
    const plaintext = Uint8Array.of(7, 8, 9);
    const envelope = await encryptPayloadWithContext(key, plaintext, context);
    expect(await decryptPayloadWithContext(key, envelope, context)).toEqual(plaintext);
    await expect(decryptPayloadWithContext(key, envelope, { ...context, profileId: "other-profile" })).rejects.toThrow("authentication failed");

    const keyPair = await generateUserEncryptionKeyPair();
    const publicKey = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const privateKey = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
    const wrappedVaultKey = await wrapKeyForRecipientWithContext(key, publicKey, { purpose: "vault-key-wrap", payloadType: "vault-encryption-key", profileId: "profile-vector", keyVersion: 1 });
    await expect(unwrapKeyForRecipientWithContext(wrappedVaultKey, privateKey, { purpose: "vault-key-wrap", payloadType: "vault-encryption-key", profileId: "profile-vector", keyVersion: 1 })).resolves.toEqual(key);

    const archiveKey = generateSymmetricKey();
    const archive = await createEncryptedVaultArchive(archiveKey, "Vector Vault", [plaintext]);
    await expect(openEncryptedVaultExport(archiveKey, archive)).resolves.toEqual({ vaultName: "Vector Vault", accounts: [plaintext] });

    const vaultKey = Uint8Array.from({ length: 32 }, (_, index) => 32 - index);
    const material = await createSecureShareLinkMaterial(vaultKey, "vault-vector");
    const recipientRootKey = generateSymmetricKey();
    const redeemed = await redeemSecureShareLinkMaterial(material.secret, material.encryptedPackage, recipientRootKey, "vault-vector");
    expect(redeemed.linkVerifier).toEqual(material.linkVerifier);
    expect(redeemed.encryptedVaultKey.length).toBeGreaterThan(16);

    key.fill(0);
    plaintext.fill(0);
    archiveKey.fill(0);
    vaultKey.fill(0);
    recipientRootKey.fill(0);
    material.linkVerifier.fill(0);
    material.encryptedPackage.fill(0);
    redeemed.linkVerifier.fill(0);
    redeemed.encryptedVaultKey.fill(0);
  });
});

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
