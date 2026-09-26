import { describe, expect, it } from "vitest";
import {
  deserializeKeyWrapEnvelope,
  generateUserEncryptionKeyPair,
  unwrapKeyForRecipientWithContext,
} from "@/modules/crypto";
import { createSharedVaultMaterial } from "@/modules/vault-management/infrastructure/browser-shared-vault-creator";

describe("createSharedVaultMaterial", () => {
  it("creates a random Vault Encryption Key and ECDH-wraps it for the owner identity", async () => {
    const owner = await generateUserEncryptionKeyPair();
    const material = await createSharedVaultMaterial(owner.publicKey, "profile-1", "Family", "vault-1");
    const envelope = deserializeKeyWrapEnvelope(material.encryptedOwnerVaultKey);
    const unwrapped = await unwrapKeyForRecipientWithContext(envelope, owner.privateKey, {
      purpose: "vault-key-wrap",
      payloadType: "vault-encryption-key",
      vaultId: "vault-1",
      recipientId: "profile-1",
      keyVersion: 1,
    });

    expect(material.vaultKey).toHaveLength(32);
    expect(material.encryptedName).not.toEqual(new TextEncoder().encode("Family"));
    expect(unwrapped).toEqual(material.vaultKey);
    expect(envelope.ephemeralPublicKey).not.toHaveProperty("d");

    unwrapped.fill(0);
    material.vaultKey.fill(0);
    material.encryptedName.fill(0);
    material.encryptedOwnerVaultKey.fill(0);
    envelope.nonce.fill(0);
    envelope.ciphertext.fill(0);
  });
});
