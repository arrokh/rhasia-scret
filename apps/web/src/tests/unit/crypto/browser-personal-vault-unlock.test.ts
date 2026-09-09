import { describe, expect, it } from "vitest";
import {
  decryptPayloadWithContext,
  encryptPayload,
  generateSymmetricKey,
  serializeEncryptedEnvelope,
  deserializeEncryptedEnvelope,
} from "@/modules/crypto/infrastructure/browser-crypto-envelope";
import { initializePersonalVaultInBrowser } from "@/modules/crypto/infrastructure/browser-personal-vault-initializer";
import {
  unlockPersonalVault,
  unlockPersonalVaultWithUserRootKey,
} from "@/modules/crypto/infrastructure/browser-personal-vault-unlock";
import { deriveVaultUnlockKey } from "@/modules/crypto/infrastructure/browser-vault-unlock-key";

describe("unlockPersonalVault", () => {
  it("recovers the Personal Vault Encryption Key only with the Vault Unlock Secret", async () => {
    const secret = "alpha bravo charlie delta echo foxtrot";
    const material = await initializePersonalVaultInBrowser(secret, "Personal Vault");
    await expect(unlockPersonalVault(secret, material)).resolves.toMatchObject({
      personalVaultKey: expect.any(Uint8Array),
    });
    const unlocked = await unlockPersonalVault(secret, material);
    await expect(unlockPersonalVault("golf hotel india juliet kilo lima", material)).rejects.toThrow(
      "authentication failed",
    );
    await expect(unlockPersonalVaultWithUserRootKey(unlocked.userRootKey, material)).resolves.toEqual(
      unlocked.personalVaultKey,
    );
  });

  it("migrates a legacy profile envelope during unlock instead of rejecting a correct secret", async () => {
    const secret = "legacy alpha bravo charlie";
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const unlockKey = await deriveVaultUnlockKey(secret, salt);
    const userRootKey = generateSymmetricKey();
    const personalVaultKey = generateSymmetricKey();
    try {
      const profile = {
        vaultUnlockSalt: salt,
        wrappedUserRootKey: serializeEncryptedEnvelope(await encryptPayload(unlockKey, userRootKey)),
        encryptedPersonalVaultKey: serializeEncryptedEnvelope(await encryptPayload(userRootKey, personalVaultKey)),
        encryptionVersion: 1,
      };

      const unlocked = await unlockPersonalVault(secret, profile);
      expect(unlocked.migratedProfile).toBeDefined();
      expect(
        deserializeEncryptedEnvelope(unlocked.migratedProfile?.wrappedUserRootKey ?? new Uint8Array()).version,
      ).toBe(2);
      expect(
        deserializeEncryptedEnvelope(unlocked.migratedProfile?.encryptedPersonalVaultKey ?? new Uint8Array()).version,
      ).toBe(2);
      await expect(unlockPersonalVault(secret, unlocked.migratedProfile as typeof profile)).resolves.toMatchObject({
        personalVaultKey,
      });
      await expect(
        decryptPayloadWithContext(
          unlocked.userRootKey,
          deserializeEncryptedEnvelope(unlocked.migratedProfile?.encryptedPersonalVaultKey ?? new Uint8Array()),
          { purpose: "vault-key-wrap", payloadType: "vault-encryption-key", keyVersion: 1 },
        ),
      ).resolves.toEqual(personalVaultKey);
    } finally {
      unlockKey.fill(0);
      userRootKey.fill(0);
      personalVaultKey.fill(0);
    }
  });
});
