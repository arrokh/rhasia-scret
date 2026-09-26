import { describe, expect, it } from "vitest";
import { initializePersonalVaultInBrowser } from "@/modules/crypto/infrastructure/browser-personal-vault-initializer";
import { clearPersonalVaultInitializationMaterial } from "@rhasia-scret/client-vault-core";

describe("initializePersonalVaultInBrowser", () => {
  it("accepts a custom Vault Unlock Secret with at least three characters", async () => {
    await expect(initializePersonalVaultInBrowser("ab", "Personal Vault")).rejects.toThrow("at least three characters");

    const material = await initializePersonalVaultInBrowser("abc", "Personal Vault");
    expect(material.encryptionVersion).toBe(1);
  });

  it("creates opaque encrypted material without returning key plaintext", async () => {
    const material = await initializePersonalVaultInBrowser("one two three four", "Personal Vault");
    expect(material.encryptionVersion).toBe(1);
    expect(material.vaultUnlockSalt).toHaveLength(16);
    expect(material.wrappedUserRootKey).not.toEqual(new TextEncoder().encode("one two three four"));
    expect(material.encryptedPersonalVaultKey).toHaveLength(61);
    expect(material.userEncryptionPublicKey).toMatchObject({ kty: "EC", crv: "P-256" });
    expect(material.userEncryptionPublicKey).not.toHaveProperty("d");
    expect(material.encryptedUserPrivateKey.length).toBeGreaterThan(61);
    expect(new TextDecoder().decode(material.encryptedUserPrivateKey)).not.toContain('"d"');
    expect(new TextDecoder().decode(material.encryptedVaultName)).not.toContain("Personal Vault");
    clearPersonalVaultInitializationMaterial(material);
    expect(material.encryptedUserPrivateKey).toEqual(new Uint8Array(material.encryptedUserPrivateKey.length));
  });
});
