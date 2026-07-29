import { describe, expect, it } from "vitest";
import { encryptPayloadWithContext, generateSymmetricKey, serializeEncryptedEnvelope } from "@/modules/crypto";
import { unlockSharedVault } from "@/modules/vault-membership";

describe("unlockSharedVault", () => {
  it("decrypts only the member's encrypted Vault Encryption Key and name locally", async () => {
    const userRootKey = generateSymmetricKey();
    const vaultKey = generateSymmetricKey();
    const encryptedVaultKey = serializeEncryptedEnvelope(await encryptPayloadWithContext(userRootKey, vaultKey, { purpose: "vault-key-wrap", payloadType: "vault-encryption-key", keyVersion: 1 }));
    const encryptedName = serializeEncryptedEnvelope(await encryptPayloadWithContext(vaultKey, new TextEncoder().encode("Family"), { purpose: "vault-name", payloadType: "vault-name", keyVersion: 1 }));
    await expect(unlockSharedVault(userRootKey, encryptedVaultKey, encryptedName)).resolves.toMatchObject({ name: "Family", vaultKey });
  });
});
