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
import { wrapUserRootKeyWithVaultUnlockSecret } from "@/modules/crypto/infrastructure/browser-vault-unlock-secret-change";
import { PersonalVaultUnlockError } from "@rhasia-scret/client-vault-core";

describe("unlockPersonalVault", () => {
  it("recovers the Personal Vault Encryption Key only with the Vault Unlock Secret", async () => {
    const secret = "alpha bravo charlie delta echo foxtrot";
    const material = await initializePersonalVaultInBrowser(secret, "Personal Vault");
    await expect(unlockPersonalVault(secret, material)).resolves.toMatchObject({
      personalVaultKey: expect.any(Uint8Array),
    });
    const unlocked = await unlockPersonalVault(secret, material);
    await expect(unlockPersonalVault("golf hotel india juliet kilo lima", material)).rejects.toMatchObject({
      name: "PersonalVaultUnlockError",
      stage: "user-root-key",
    } satisfies Partial<PersonalVaultUnlockError>);
    await expect(unlockPersonalVault("x", material)).rejects.toMatchObject({
      name: "PersonalVaultUnlockError",
      stage: "invalid-secret",
    } satisfies Partial<PersonalVaultUnlockError>);
    await expect(unlockPersonalVault(secret, { ...material, encryptionVersion: 2 })).rejects.toMatchObject({
      name: "PersonalVaultUnlockError",
      stage: "invalid-profile",
    } satisfies Partial<PersonalVaultUnlockError>);
    await expect(unlockPersonalVaultWithUserRootKey(unlocked.userRootKey, material)).resolves.toEqual(
      unlocked.personalVaultKey,
    );
  });

  it("unlocks with the replacement passphrase after the User Root Key is rewrapped", async () => {
    const originalSecret = "original alpha bravo charlie";
    const replacementSecret = "replacement delta echo foxtrot";
    const profile = await initializePersonalVaultInBrowser(originalSecret, "Personal Vault");
    let originalUnlock: Awaited<ReturnType<typeof unlockPersonalVault>> | undefined;
    let replacementUnlock: Awaited<ReturnType<typeof unlockPersonalVault>> | undefined;
    let replacementProfile: { vaultUnlockSalt: Uint8Array; wrappedUserRootKey: Uint8Array } | undefined;

    try {
      originalUnlock = await unlockPersonalVault(originalSecret, profile);
      replacementProfile = await wrapUserRootKeyWithVaultUnlockSecret(originalUnlock.userRootKey, replacementSecret);
      const rewrappedProfile = {
        ...profile,
        vaultUnlockSalt: replacementProfile.vaultUnlockSalt,
        wrappedUserRootKey: replacementProfile.wrappedUserRootKey,
      };
      replacementUnlock = await unlockPersonalVault(replacementSecret, rewrappedProfile);

      expect(replacementUnlock.userRootKey).toEqual(originalUnlock.userRootKey);
      expect(replacementUnlock.personalVaultKey).toEqual(originalUnlock.personalVaultKey);
      await expect(unlockPersonalVault(originalSecret, rewrappedProfile)).rejects.toMatchObject({
        name: "PersonalVaultUnlockError",
        stage: "user-root-key",
      });
    } finally {
      originalUnlock?.userRootKey.fill(0);
      originalUnlock?.personalVaultKey.fill(0);
      replacementUnlock?.userRootKey.fill(0);
      replacementUnlock?.personalVaultKey.fill(0);
      replacementProfile?.vaultUnlockSalt.fill(0);
      replacementProfile?.wrappedUserRootKey.fill(0);
      profile.vaultUnlockSalt.fill(0);
      profile.wrappedUserRootKey.fill(0);
      profile.encryptedPersonalVaultKey.fill(0);
      profile.encryptedVaultName.fill(0);
      profile.encryptedUserPrivateKey.fill(0);
    }
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
