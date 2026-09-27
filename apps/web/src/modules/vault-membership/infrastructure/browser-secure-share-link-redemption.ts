"use client";

import type { PortableJsonWebKey } from "@rhasia-scret/client-vault-core";
import { browserClientCryptoPort } from "@/modules/crypto";
import { redeemSecureShareLinkMaterialWithCrypto } from "@rhasia-scret/client-vault-core";

export function redeemSecureShareLinkMaterial(
  secret: string,
  encryptedPackage: Uint8Array,
  recipient: { profileId: string; publicKey: PortableJsonWebKey },
  vaultId: string,
  keyVersion: number,
): Promise<{ linkVerifier: Uint8Array; encryptedVaultKey: Uint8Array }> {
  return redeemSecureShareLinkMaterialWithCrypto(
    secret,
    encryptedPackage,
    recipient,
    vaultId,
    keyVersion,
    browserClientCryptoPort,
    async (value) => new Uint8Array(await crypto.subtle.digest("SHA-256", value.slice())),
  );
}
