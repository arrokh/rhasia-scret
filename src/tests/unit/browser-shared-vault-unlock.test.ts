import { describe, expect, it } from "vitest";
import { encryptPayload, generateSymmetricKey, serializeEncryptedEnvelope } from "@/modules/crypto";
import { unlockSharedVault } from "@/modules/vault-membership";

describe("unlockSharedVault", () => {
  it("decrypts only the member's encrypted Vault Encryption Key and name locally", async () => {
    const userRootKey = generateSymmetricKey();
    const vaultKey = generateSymmetricKey();
    const encryptedVaultKey = serializeEncryptedEnvelope(await encryptPayload(userRootKey, vaultKey));
    const encryptedName = serializeEncryptedEnvelope(await encryptPayload(vaultKey, new TextEncoder().encode("Family")));
    await expect(unlockSharedVault(userRootKey, encryptedVaultKey, encryptedName)).resolves.toMatchObject({ name: "Family", vaultKey });
  });
});
