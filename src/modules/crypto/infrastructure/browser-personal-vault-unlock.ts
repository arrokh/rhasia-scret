"use client";

import { decryptPayload, deserializeEncryptedEnvelope } from "./browser-crypto-envelope";
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
  const userRootKey = await decryptPayload(unlockKey, deserializeEncryptedEnvelope(profile.wrappedUserRootKey));
  const personalVaultKey = await decryptPayload(userRootKey, deserializeEncryptedEnvelope(profile.encryptedPersonalVaultKey));
  if (personalVaultKey.length !== 32) throw new Error("Personal Vault Encryption Key is invalid.");
  return { userRootKey, personalVaultKey };
}
