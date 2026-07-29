import { describe, expect, it } from "vitest";
import { decryptPayloadWithContext, deserializeEncryptedEnvelope, generateSymmetricKey } from "@/modules/crypto";
import { createSecureShareLinkMaterial, redeemSecureShareLinkMaterial } from "@/modules/vault-membership";

describe("redeemSecureShareLinkMaterial", () => {
  it("unwraps the Vault Encryption Key client-side and re-encrypts it for the recipient", async () => {
    const vaultKey = generateSymmetricKey();
    const ownerLink = await createSecureShareLinkMaterial(vaultKey);
    const userRootKey = generateSymmetricKey();
    const redeemed = await redeemSecureShareLinkMaterial(ownerLink.secret, ownerLink.encryptedPackage, userRootKey);
    await expect(decryptPayloadWithContext(userRootKey, deserializeEncryptedEnvelope(redeemed.encryptedVaultKey), { purpose: "vault-key-wrap", payloadType: "vault-encryption-key", keyVersion: 1 })).resolves.toEqual(vaultKey);
  });
});
