"use client";

import { decryptPayloadWithContext, deserializeEncryptedEnvelope } from "./browser-crypto-envelope";
import { deriveVaultUnlockKey } from "./browser-vault-unlock-key";

export type EncryptedPersonalVaultProfile = {
  vaultUnlockSalt: Uint8Array;
  wrappedUserRootKey: Uint8Array;
  encryptedPersonalVaultKey: Uint8Array;
  encryptionVersion: number;
};

export async function unlockPersonalVault(vaultUnlockSecret: string, profile: EncryptedPersonalVaultProfile): Promise<{ userRootKey: Uint8Array; personalVaultKey: Uint8Array }> {
  if (profile.encryptionVersion !== 1) throw new Error("Unsupported encryption version.");
  const unlockKey = await deriveVaultUnlockKey(vaultUnlockSecret, profile.vaultUnlockSalt);
  let userRootKey: Uint8Array | undefined;
  try {
    userRootKey = await decryptPayloadWithContext(unlockKey, deserializeEncryptedEnvelope(profile.wrappedUserRootKey), { purpose: "user-root-key-wrap", payloadType: "user-root-key", keyVersion: 1 });
    const personalVaultKey = await unlockPersonalVaultWithUserRootKey(userRootKey, profile);
    return { userRootKey, personalVaultKey };
  } catch (error) {
    userRootKey?.fill(0);
    throw error;
  } finally {
    unlockKey.fill(0);
  }
}

export async function unlockPersonalVaultWithUserRootKey(userRootKey: Uint8Array, profile: EncryptedPersonalVaultProfile): Promise<Uint8Array> {
  if (profile.encryptionVersion !== 1) throw new Error("Unsupported encryption version.");
  const personalVaultKey = await decryptPayloadWithContext(userRootKey, deserializeEncryptedEnvelope(profile.encryptedPersonalVaultKey), { purpose: "vault-key-wrap", payloadType: "vault-encryption-key", keyVersion: 1 });
  if (personalVaultKey.length !== 32) throw new Error("Personal Vault Encryption Key is invalid.");
  return personalVaultKey;
}
