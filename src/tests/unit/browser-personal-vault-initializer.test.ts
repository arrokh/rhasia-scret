import { describe, expect, it } from "vitest";
import { initializePersonalVaultInBrowser } from "@/modules/crypto/infrastructure/browser-personal-vault-initializer";

describe("initializePersonalVaultInBrowser", () => {
  it("rejects a Vault Unlock Secret with fewer than four words", async () => {
    await expect(initializePersonalVaultInBrowser("one two three", "Personal Vault")).rejects.toThrow(
      "at least four words"
    );
  });

  it("creates opaque encrypted material without returning key plaintext", async () => {
    const material = await initializePersonalVaultInBrowser("one two three four", "Personal Vault");
    expect(material.encryptionVersion).toBe(1);
    expect(material.vaultUnlockSalt).toHaveLength(16);
    expect(material.wrappedUserRootKey).not.toEqual(new TextEncoder().encode("one two three four"));
    expect(material.encryptedPersonalVaultKey).toHaveLength(61);
    expect(new TextDecoder().decode(material.encryptedVaultName)).not.toContain("Personal Vault");
  });
});
