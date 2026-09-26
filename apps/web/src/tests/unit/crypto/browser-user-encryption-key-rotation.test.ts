import { describe, expect, it } from "vitest";
import {
  createUserEncryptionIdentity,
  deserializeKeyWrapEnvelope,
  generateSymmetricKey,
  recoverUserEncryptionPrivateKey,
  rotateUserEncryptionIdentity,
  serializeEncryptedEnvelope,
  serializeKeyWrapEnvelope,
  unwrapKeyForRecipientWithContext,
  wrapKeyForRecipientWithContext,
} from "@/modules/crypto";

describe("rotateUserEncryptionIdentity", () => {
  it("re-wraps Vault Encryption Key packages under a fresh browser identity", async () => {
    const rootKey = generateSymmetricKey();
    const vaultKey = generateSymmetricKey();
    const original = await createUserEncryptionIdentity(rootKey);
    const membership = { vaultId: "vault-1", recipientId: "user-1", keyVersion: 2 } as const;
    const context = {
      purpose: "vault-key-wrap",
      payloadType: "vault-encryption-key",
      ...membership,
    } as const;
    const packageBytes = serializeKeyWrapEnvelope(
      await wrapKeyForRecipientWithContext(vaultKey, original.publicKey, context),
    );
    const rotated = await rotateUserEncryptionIdentity(
      rootKey,
      serializeEncryptedEnvelope(original.encryptedPrivateKey),
      [{ ...membership, encryptedVaultKey: packageBytes }],
    );
    expect(rotated.identity.publicKey).not.toEqual(original.publicKey);
    const freshPrivateKey = await recoverUserEncryptionPrivateKey(rootKey, rotated.identity.encryptedPrivateKey);
    await expect(
      unwrapKeyForRecipientWithContext(
        deserializeKeyWrapEnvelope(rotated.wrappedVaultKeys[0]!.encryptedVaultKey),
        freshPrivateKey,
        context,
      ),
    ).resolves.toEqual(vaultKey);
  });
});
