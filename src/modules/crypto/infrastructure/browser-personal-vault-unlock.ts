"use client";

import { decryptPayload, decryptPayloadWithContext, deserializeEncryptedEnvelope, encryptPayloadWithContext, serializeEncryptedEnvelope } from "./browser-crypto-envelope";
import { deriveVaultUnlockKey } from "./browser-vault-unlock-key";

export type EncryptedPersonalVaultProfile = {
  vaultUnlockSalt: Uint8Array;
  wrappedUserRootKey: Uint8Array;
  encryptedPersonalVaultKey: Uint8Array;
  encryptionVersion: number;
};

export type PersonalVaultUnlockResult = {
  userRootKey: Uint8Array;
  personalVaultKey: Uint8Array;
  migratedProfile?: EncryptedPersonalVaultProfile;
};

export async function unlockPersonalVault(vaultUnlockSecret: string, profile: EncryptedPersonalVaultProfile): Promise<PersonalVaultUnlockResult> {
  if (profile.encryptionVersion !== 1) throw new Error("Unsupported encryption version.");
  const unlockKey = await deriveVaultUnlockKey(vaultUnlockSecret, profile.vaultUnlockSalt);
  let userRootKey: Uint8Array | undefined;
  let personalVaultKey: Uint8Array | undefined;
  try {
    const wrappedUserRootKey = deserializeEncryptedEnvelope(profile.wrappedUserRootKey);
    userRootKey = await decryptProfilePayload(unlockKey, wrappedUserRootKey, { purpose: "user-root-key-wrap", payloadType: "user-root-key", keyVersion: 1 });
    const encryptedPersonalVaultKey = deserializeEncryptedEnvelope(profile.encryptedPersonalVaultKey);
    personalVaultKey = await decryptProfilePayload(userRootKey, encryptedPersonalVaultKey, { purpose: "vault-key-wrap", payloadType: "vault-encryption-key", keyVersion: 1 });
    if (personalVaultKey.length !== 32) throw new Error("Personal Vault Encryption Key is invalid.");
    const migratedProfile = wrappedUserRootKey.version === 1 || encryptedPersonalVaultKey.version === 1
      ? await migrateLegacyProfile(profile, unlockKey, userRootKey, personalVaultKey, wrappedUserRootKey, encryptedPersonalVaultKey)
      : undefined;
    return { userRootKey, personalVaultKey, migratedProfile };
  } catch (error) {
    userRootKey?.fill(0);
    personalVaultKey?.fill(0);
    throw error;
  } finally {
    unlockKey.fill(0);
  }
}

export async function unlockPersonalVaultWithUserRootKey(userRootKey: Uint8Array, profile: EncryptedPersonalVaultProfile): Promise<Uint8Array> {
  if (profile.encryptionVersion !== 1) throw new Error("Unsupported encryption version.");
  const personalVaultKey = await decryptProfilePayload(
    userRootKey,
    deserializeEncryptedEnvelope(profile.encryptedPersonalVaultKey),
    { purpose: "vault-key-wrap", payloadType: "vault-encryption-key", keyVersion: 1 }
  );
  if (personalVaultKey.length !== 32) throw new Error("Personal Vault Encryption Key is invalid.");
  return personalVaultKey;
}

async function decryptProfilePayload(
  key: Uint8Array,
  envelope: ReturnType<typeof deserializeEncryptedEnvelope>,
  context: Parameters<typeof decryptPayloadWithContext>[2]
): Promise<Uint8Array> {
  return envelope.version === 1
    ? decryptPayload(key, envelope)
    : decryptPayloadWithContext(key, envelope, context);
}

async function migrateLegacyProfile(
  profile: EncryptedPersonalVaultProfile,
  unlockKey: Uint8Array,
  userRootKey: Uint8Array,
  personalVaultKey: Uint8Array,
  wrappedUserRootKey: ReturnType<typeof deserializeEncryptedEnvelope>,
  encryptedPersonalVaultKey: ReturnType<typeof deserializeEncryptedEnvelope>
): Promise<EncryptedPersonalVaultProfile> {
  const migratedWrappedUserRootKey = wrappedUserRootKey.version === 1
    ? serializeEncryptedEnvelope(await encryptPayloadWithContext(unlockKey, userRootKey, { purpose: "user-root-key-wrap", payloadType: "user-root-key", keyVersion: 1 }))
    : profile.wrappedUserRootKey.slice();
  const migratedPersonalVaultKey = encryptedPersonalVaultKey.version === 1
    ? serializeEncryptedEnvelope(await encryptPayloadWithContext(userRootKey, personalVaultKey, { purpose: "vault-key-wrap", payloadType: "vault-encryption-key", keyVersion: 1 }))
    : profile.encryptedPersonalVaultKey.slice();
  return {
    vaultUnlockSalt: profile.vaultUnlockSalt.slice(),
    wrappedUserRootKey: migratedWrappedUserRootKey,
    encryptedPersonalVaultKey: migratedPersonalVaultKey,
    encryptionVersion: profile.encryptionVersion
  };
}
