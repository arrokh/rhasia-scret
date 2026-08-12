import {
  createPersonalVaultInitialization,
  type PersonalVaultInitializationMaterial,
} from "../../../../src/modules/crypto/application/create-personal-vault-initialization";
import { nativeArgon2idPort } from "../infrastructure/native-argon2id";
import { nativeClientCrypto } from "../infrastructure/native-client-crypto";

/** Creates only protocol ciphertext; the caller sends the result through an authorized API repository. */
export function createMobilePersonalVaultInitialization(
  vaultUnlockSecret: string,
  vaultName: string,
): Promise<PersonalVaultInitializationMaterial> {
  return createPersonalVaultInitialization(vaultUnlockSecret, vaultName, {
    crypto: nativeClientCrypto,
    keyDerivation: nativeArgon2idPort,
  });
}
