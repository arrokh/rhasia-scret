import { describe, expect, it } from "vitest";
import { createUserEncryptionIdentity, deserializeKeyWrapEnvelope, generateSymmetricKey, recoverUserEncryptionPrivateKey, rotateUserEncryptionIdentity, serializeEncryptedEnvelope, serializeKeyWrapEnvelope, unwrapKeyForRecipientWithContext, wrapKeyForRecipientWithContext } from "@/modules/crypto";

describe("rotateUserEncryptionIdentity", () => {
  it("re-wraps Vault Encryption Key packages under a fresh browser identity", async () => {
    const rootKey = generateSymmetricKey();
    const vaultKey = generateSymmetricKey();
    const original = await createUserEncryptionIdentity(rootKey);
    const context = { purpose: "vault-key-wrap", payloadType: "vault-encryption-key", keyVersion: 1 } as const;
    const packageBytes = serializeKeyWrapEnvelope(await wrapKeyForRecipientWithContext(vaultKey, original.publicKey, context));
    const rotated = await rotateUserEncryptionIdentity(rootKey, serializeEncryptedEnvelope(original.encryptedPrivateKey), [packageBytes]);
    expect(rotated.identity.publicKey).not.toEqual(original.publicKey);
    const freshPrivateKey = await recoverUserEncryptionPrivateKey(rootKey, rotated.identity.encryptedPrivateKey);
    await expect(unwrapKeyForRecipientWithContext(deserializeKeyWrapEnvelope(rotated.wrappedVaultKeys[0]), freshPrivateKey, context)).resolves.toEqual(vaultKey);
  });
});
