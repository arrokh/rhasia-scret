"use client";

import {
  unlockPersonalVault as unlockPersonalVaultWithPorts,
  unlockPersonalVaultWithUserRootKey as unlockPersonalVaultWithRootKeyAndPort,
  type EncryptedPersonalVaultProfile,
  type PersonalVaultUnlockResult,
} from "@rhasia-scret/client-vault-core";
import { browserClientCryptoPort } from "./browser-client-crypto-port";
import { browserArgon2idPort } from "./browser-vault-unlock-key";

export type {
  EncryptedPersonalVaultProfile,
  PersonalVaultUnlockResult,
} from "@rhasia-scret/client-vault-core";

export function unlockPersonalVault(
  vaultUnlockSecret: string,
  profile: EncryptedPersonalVaultProfile,
): Promise<PersonalVaultUnlockResult> {
  return unlockPersonalVaultWithPorts(vaultUnlockSecret, profile, {
    crypto: browserClientCryptoPort,
    keyDerivation: browserArgon2idPort,
  });
}

export function unlockPersonalVaultWithUserRootKey(
  userRootKey: Uint8Array,
  profile: EncryptedPersonalVaultProfile,
): Promise<Uint8Array> {
  return unlockPersonalVaultWithRootKeyAndPort(userRootKey, profile, browserClientCryptoPort);
}
