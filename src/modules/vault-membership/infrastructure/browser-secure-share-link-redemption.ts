"use client";

import { browserClientCryptoPort } from "@/modules/crypto";
import { redeemSecureShareLinkMaterialWithCrypto } from "../application/redeem-secure-share-link-material";

export function redeemSecureShareLinkMaterial(
  secret: string,
  encryptedPackage: Uint8Array,
  userRootKey: Uint8Array,
  vaultId?: string,
): Promise<{ linkVerifier: Uint8Array; encryptedVaultKey: Uint8Array }> {
  return redeemSecureShareLinkMaterialWithCrypto(
    secret,
    encryptedPackage,
    userRootKey,
    vaultId,
    browserClientCryptoPort,
    async (value) => new Uint8Array(await crypto.subtle.digest("SHA-256", value.slice())),
  );
}
