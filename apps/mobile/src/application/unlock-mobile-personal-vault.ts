import {
  unlockPersonalVault,
  unlockPersonalVaultWithUserRootKey,
  type EncryptedPersonalVaultProfile,
  type PersonalVaultUnlockResult,
} from "@rhasia-scret/client-vault-core";
import { nativeArgon2idPort } from "../infrastructure/native-argon2id";
import { nativeClientCrypto } from "../infrastructure/native-client-crypto";

export function unlockMobilePersonalVault(
  vaultUnlockSecret: string,
  profile: EncryptedPersonalVaultProfile,
): Promise<PersonalVaultUnlockResult> {
  return unlockPersonalVault(vaultUnlockSecret, profile, {
    crypto: nativeClientCrypto,
    keyDerivation: nativeArgon2idPort,
  });
}

export function unlockMobilePersonalVaultWithUserRootKey(
  userRootKey: Uint8Array,
  profile: EncryptedPersonalVaultProfile,
): Promise<Uint8Array> {
  return unlockPersonalVaultWithUserRootKey(userRootKey, profile, nativeClientCrypto);
}
