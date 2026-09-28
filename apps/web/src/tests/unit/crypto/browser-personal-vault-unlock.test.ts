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
    const rootKeyUnlock = await unlockPersonalVaultWithUserRootKey(unlocked.userRootKey, material);
    expect(rootKeyUnlock.personalVaultKey).toEqual(unlocked.personalVaultKey);
    expect(rootKeyUnlock.migratedProfile).toBeUndefined();
    rootKeyUnlock.personalVaultKey.fill(0);
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
      const originalWrappedUserRootKey = profile.wrappedUserRootKey.slice();
      const originalEncryptedPersonalVaultKey = profile.encryptedPersonalVaultKey.slice();
      const legacyWrappedEnvelope = deserializeEncryptedEnvelope(profile.wrappedUserRootKey);
      const legacyPersonalKeyEnvelope = deserializeEncryptedEnvelope(profile.encryptedPersonalVaultKey);
      let unlocked: Awaited<ReturnType<typeof unlockPersonalVault>> | undefined;
      let migratedUnlock: Awaited<ReturnType<typeof unlockPersonalVault>> | undefined;
      try {
        await expect(unlockPersonalVault("wrong legacy alpha bravo", profile)).rejects.toMatchObject({
          name: "PersonalVaultUnlockError",
          stage: "user-root-key",
        } satisfies Partial<PersonalVaultUnlockError>);
        expect(profile.wrappedUserRootKey).toEqual(originalWrappedUserRootKey);
        expect(profile.encryptedPersonalVaultKey).toEqual(originalEncryptedPersonalVaultKey);

        unlocked = await unlockPersonalVault(secret, profile);
        expect(profile.wrappedUserRootKey).toEqual(originalWrappedUserRootKey);
        expect(profile.encryptedPersonalVaultKey).toEqual(originalEncryptedPersonalVaultKey);
        if (!unlocked.migratedProfile) throw new Error("Legacy profile migration result is missing.");
        const migratedProfile = unlocked.migratedProfile;
        const migratedWrappedEnvelope = deserializeEncryptedEnvelope(migratedProfile.wrappedUserRootKey);
        const migratedPersonalKeyEnvelope = deserializeEncryptedEnvelope(migratedProfile.encryptedPersonalVaultKey);
        try {
          expect(legacyWrappedEnvelope.version).toBe(1);
          expect(legacyPersonalKeyEnvelope.version).toBe(1);
          expect(migratedWrappedEnvelope.version).toBe(2);
          expect(migratedPersonalKeyEnvelope.version).toBe(2);
          expect(migratedWrappedEnvelope.nonce).not.toEqual(legacyWrappedEnvelope.nonce);
          expect(migratedPersonalKeyEnvelope.nonce).not.toEqual(legacyPersonalKeyEnvelope.nonce);
        } finally {
          migratedWrappedEnvelope.nonce.fill(0);
          migratedWrappedEnvelope.ciphertext.fill(0);
          migratedPersonalKeyEnvelope.nonce.fill(0);
          migratedPersonalKeyEnvelope.ciphertext.fill(0);
        }
        migratedUnlock = await unlockPersonalVault(secret, migratedProfile);
        expect(migratedUnlock.personalVaultKey).toEqual(personalVaultKey);
        const decryptedPersonalVaultKeyEnvelope = deserializeEncryptedEnvelope(
          migratedProfile.encryptedPersonalVaultKey,
        );
        let decryptedPersonalVaultKey: Uint8Array | undefined;
        try {
          await expect(
            decryptPayloadWithContext(unlocked.userRootKey, decryptedPersonalVaultKeyEnvelope, {
              purpose: "vault-name",
              payloadType: "vault-name",
              keyVersion: 1,
            }),
          ).rejects.toThrow();
          decryptedPersonalVaultKey = await decryptPayloadWithContext(
            unlocked.userRootKey,
            decryptedPersonalVaultKeyEnvelope,
            { purpose: "vault-key-wrap", payloadType: "vault-encryption-key", keyVersion: 1 },
          );
          expect(decryptedPersonalVaultKey).toEqual(personalVaultKey);
        } finally {
          decryptedPersonalVaultKeyEnvelope.nonce.fill(0);
          decryptedPersonalVaultKeyEnvelope.ciphertext.fill(0);
          decryptedPersonalVaultKey?.fill(0);
        }
      } finally {
        originalWrappedUserRootKey.fill(0);
        originalEncryptedPersonalVaultKey.fill(0);
        profile.wrappedUserRootKey.fill(0);
        profile.encryptedPersonalVaultKey.fill(0);
        legacyWrappedEnvelope.nonce.fill(0);
        legacyWrappedEnvelope.ciphertext.fill(0);
        legacyPersonalKeyEnvelope.nonce.fill(0);
        legacyPersonalKeyEnvelope.ciphertext.fill(0);
        unlocked?.userRootKey.fill(0);
        unlocked?.personalVaultKey.fill(0);
        unlocked?.migratedProfile?.vaultUnlockSalt.fill(0);
        unlocked?.migratedProfile?.wrappedUserRootKey.fill(0);
        unlocked?.migratedProfile?.encryptedPersonalVaultKey.fill(0);
        migratedUnlock?.userRootKey.fill(0);
        migratedUnlock?.personalVaultKey.fill(0);
        migratedUnlock?.migratedProfile?.vaultUnlockSalt.fill(0);
        migratedUnlock?.migratedProfile?.wrappedUserRootKey.fill(0);
        migratedUnlock?.migratedProfile?.encryptedPersonalVaultKey.fill(0);
      }
    } finally {
      unlockKey.fill(0);
      userRootKey.fill(0);
      personalVaultKey.fill(0);
    }
  });
});
