import { describe, expect, it } from "vitest";
import {
  generateSymmetricKey,
  generateUserEncryptionKeyPair,
  deserializeKeyWrapEnvelope,
  unwrapKeyForRecipientWithContext,
} from "@/modules/crypto";
import { createSecureShareLinkMaterial, redeemSecureShareLinkMaterial } from "@/modules/vault-membership";

describe("redeemSecureShareLinkMaterial", () => {
  it("unwraps the Vault Encryption Key client-side and re-encrypts it for the recipient", async () => {
    const vaultKey = generateSymmetricKey();
    const ownerLink = await createSecureShareLinkMaterial(vaultKey, "vault-1");
    const identity = await generateUserEncryptionKeyPair();
    const recipient = { profileId: "profile-1", publicKey: identity.publicKey };
    const redeemed = await redeemSecureShareLinkMaterial(
      ownerLink.secret,
      ownerLink.encryptedPackage,
      recipient,
      "vault-1",
      7,
    );
    const envelope = deserializeKeyWrapEnvelope(redeemed.encryptedVaultKey);
    await expect(
      unwrapKeyForRecipientWithContext(envelope, identity.privateKey, {
        purpose: "vault-key-wrap",
        payloadType: "vault-encryption-key",
        vaultId: "vault-1",
        recipientId: recipient.profileId,
        keyVersion: 7,
      }),
    ).resolves.toEqual(vaultKey);
  });
});
