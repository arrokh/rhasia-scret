import { describe, expect, it } from "vitest";
import { createUserEncryptionIdentity, deserializeKeyWrapEnvelope, generateSymmetricKey, recoverUserEncryptionPrivateKey, rotateUserEncryptionIdentity, serializeEncryptedEnvelope, serializeKeyWrapEnvelope, unwrapKeyForRecipient, wrapKeyForRecipient } from "@/modules/crypto";

describe("rotateUserEncryptionIdentity", () => {
  it("re-wraps Vault Encryption Key packages under a fresh browser identity", async () => {
    const rootKey = generateSymmetricKey();
    const vaultKey = generateSymmetricKey();
    const original = await createUserEncryptionIdentity(rootKey);
    const packageBytes = serializeKeyWrapEnvelope(await wrapKeyForRecipient(vaultKey, original.publicKey));
    const rotated = await rotateUserEncryptionIdentity(rootKey, serializeEncryptedEnvelope(original.encryptedPrivateKey), [packageBytes]);
    expect(rotated.identity.publicKey).not.toEqual(original.publicKey);
    const freshPrivateKey = await recoverUserEncryptionPrivateKey(rootKey, rotated.identity.encryptedPrivateKey);
    await expect(unwrapKeyForRecipient(deserializeKeyWrapEnvelope(rotated.wrappedVaultKeys[0]), freshPrivateKey)).resolves.toEqual(vaultKey);
  });
});
