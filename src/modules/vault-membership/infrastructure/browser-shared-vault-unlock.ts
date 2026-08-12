"use client";

import { browserClientCryptoPort } from "@/modules/crypto";
import { unlockSharedVaultWithCrypto } from "../application/unlock-shared-vault";

export function unlockSharedVault(
  userRootKey: Uint8Array,
  encryptedVaultKey: Uint8Array,
  encryptedName: Uint8Array,
  vaultId?: string,
): Promise<{ vaultKey: Uint8Array; name: string }> {
  return unlockSharedVaultWithCrypto(browserClientCryptoPort, userRootKey, encryptedVaultKey, encryptedName, vaultId);
}
