"use client";

import {
  createPersonalVaultInitialization,
  type PersonalVaultInitializationMaterial,
} from "@rhasia-scret/client-vault-core";
import { browserArgon2idPort } from "./browser-vault-unlock-key";
import { browserClientCryptoPort } from "./browser-client-crypto-port";

export type { PersonalVaultInitializationMaterial } from "@rhasia-scret/client-vault-core";

export function initializePersonalVaultInBrowser(
  vaultUnlockSecret: string,
  vaultName: string,
): Promise<PersonalVaultInitializationMaterial> {
  return createPersonalVaultInitialization(vaultUnlockSecret, vaultName, {
    crypto: browserClientCryptoPort,
    keyDerivation: browserArgon2idPort,
  });
}
