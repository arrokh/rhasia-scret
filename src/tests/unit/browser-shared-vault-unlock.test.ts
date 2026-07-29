import { describe, expect, it } from "vitest";
import { encryptPayload, encryptPayloadWithContext, generateSymmetricKey, serializeEncryptedEnvelope } from "@/modules/crypto";
import { unlockSharedVault } from "@/modules/vault-membership";

describe("unlockSharedVault", () => {
  it("decrypts only the member's encrypted Vault Encryption Key and name locally", async () => {
    const userRootKey = generateSymmetricKey();
    const vaultKey = generateSymmetricKey();
    const encryptedVaultKey = serializeEncryptedEnvelope(await encryptPayloadWithContext(userRootKey, vaultKey, { purpose: "vault-key-wrap", payloadType: "vault-encryption-key", keyVersion: 1 }));
    const encryptedName = serializeEncryptedEnvelope(await encryptPayloadWithContext(vaultKey, new TextEncoder().encode("Family"), { purpose: "vault-name", payloadType: "vault-name", keyVersion: 1 }));
    await expect(unlockSharedVault(userRootKey, encryptedVaultKey, encryptedName)).resolves.toMatchObject({ name: "Family", vaultKey });
  });

  it("reads legacy member key and name envelopes during the explicit unlock migration path", async () => {
    const userRootKey = generateSymmetricKey();
    const vaultKey = generateSymmetricKey();
    const encryptedVaultKey = serializeEncryptedEnvelope(await encryptPayload(userRootKey, vaultKey));
    const encryptedName = serializeEncryptedEnvelope(await encryptPayload(vaultKey, new TextEncoder().encode("Legacy Family")));
    await expect(unlockSharedVault(userRootKey, encryptedVaultKey, encryptedName, "legacy-vault")).resolves.toMatchObject({ name: "Legacy Family", vaultKey });
  });
});
