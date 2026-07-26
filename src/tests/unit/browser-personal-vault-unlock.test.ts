import { describe, expect, it } from "vitest";
import { initializePersonalVaultInBrowser } from "@/modules/crypto/infrastructure/browser-personal-vault-initializer";
import { unlockPersonalVault, unlockPersonalVaultWithUserRootKey } from "@/modules/crypto/infrastructure/browser-personal-vault-unlock";

describe("unlockPersonalVault", () => {
  it("recovers the Personal Vault Encryption Key only with the Vault Unlock Secret", async () => {
    const secret = "alpha bravo charlie delta echo foxtrot";
    const material = await initializePersonalVaultInBrowser(secret, "Personal Vault");
    await expect(unlockPersonalVault(secret, material)).resolves.toMatchObject({ personalVaultKey: expect.any(Uint8Array) });
    const unlocked = await unlockPersonalVault(secret, material);
    await expect(unlockPersonalVault("golf hotel india juliet kilo lima", material)).rejects.toThrow("authentication failed");
    await expect(unlockPersonalVaultWithUserRootKey(unlocked.userRootKey, material)).resolves.toEqual(unlocked.personalVaultKey);
  });
});
