import { describe, expect, it } from "vitest";
import {
  createUserEncryptionIdentity,
  encryptPayload,
  encryptPayloadWithContext,
  generateSymmetricKey,
  recoverUserEncryptionPrivateKey,
  serializeEncryptedEnvelope,
  serializeKeyWrapEnvelope,
  wrapKeyForRecipientWithContext,
} from "@/modules/crypto";
import { unlockSharedVault } from "@/modules/vault-membership";

describe("unlockSharedVault", () => {
  it("decrypts only the member's encrypted Vault Encryption Key and name locally", async () => {
    const userRootKey = generateSymmetricKey();
    const vaultKey = generateSymmetricKey();
    const encryptedVaultKey = serializeEncryptedEnvelope(
      await encryptPayloadWithContext(userRootKey, vaultKey, {
        purpose: "vault-key-wrap",
        payloadType: "vault-encryption-key",
        vaultId: "shared-vault",
        keyVersion: 1,
      }),
    );
    const encryptedName = serializeEncryptedEnvelope(
      await encryptPayloadWithContext(vaultKey, new TextEncoder().encode("Family"), {
        purpose: "vault-name",
        payloadType: "vault-name",
        vaultId: "shared-vault",
        keyVersion: 1,
      }),
    );
    await expect(
      unlockSharedVault(userRootKey, encryptedVaultKey, encryptedName, {
        vaultId: "shared-vault",
        recipientId: "user-1",
        keyVersion: 1,
      }),
    ).resolves.toMatchObject({
      name: "Family",
      vaultKey,
    });
  });

  it("unlocks a context-bound ECDH member package in the browser", async () => {
    const userRootKey = generateSymmetricKey();
    const vaultKey = generateSymmetricKey();
    const vaultId = "shared-vault";
    const recipientId = "user-1";
    const keyVersion = 2;
    const identity = await createUserEncryptionIdentity(userRootKey);
    const privateKey = await recoverUserEncryptionPrivateKey(userRootKey, identity.encryptedPrivateKey);
    const encryptedVaultKey = serializeKeyWrapEnvelope(
      await wrapKeyForRecipientWithContext(vaultKey, identity.publicKey, {
        purpose: "vault-key-wrap",
        payloadType: "vault-encryption-key",
        vaultId,
        recipientId,
        keyVersion,
      }),
    );
    const encryptedName = serializeEncryptedEnvelope(
      await encryptPayloadWithContext(vaultKey, new TextEncoder().encode("Browser Test Vault"), {
        purpose: "vault-name",
        payloadType: "vault-name",
        vaultId,
        keyVersion: 1,
      }),
    );

    await expect(
      unlockSharedVault(userRootKey, encryptedVaultKey, encryptedName, {
        vaultId,
        recipientId,
        keyVersion,
        userEncryptionPrivateKey: privateKey,
      }),
    ).resolves.toMatchObject({ name: "Browser Test Vault", vaultKey });
  });

  it("reads legacy member key and name envelopes during the explicit unlock migration path", async () => {
    const userRootKey = generateSymmetricKey();
    const vaultKey = generateSymmetricKey();
    const encryptedVaultKey = serializeEncryptedEnvelope(await encryptPayload(userRootKey, vaultKey));
    const encryptedName = serializeEncryptedEnvelope(
      await encryptPayload(vaultKey, new TextEncoder().encode("Legacy Family")),
    );
    await expect(
      unlockSharedVault(userRootKey, encryptedVaultKey, encryptedName, {
        vaultId: "legacy-vault",
        recipientId: "user-1",
        keyVersion: 1,
      }),
    ).resolves.toMatchObject({ name: "Legacy Family", vaultKey });
  });
});
