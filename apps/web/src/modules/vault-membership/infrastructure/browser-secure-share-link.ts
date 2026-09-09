"use client";

import { browserClientCryptoPort } from "@/modules/crypto";
import { createSecureShareLinkMaterialWithCrypto, type SecureShareLinkMaterial } from "@rhasia-scret/client-vault-core";

export type { SecureShareLinkMaterial };

export function createSecureShareLinkMaterial(
  vaultKey: Uint8Array,
  vaultId?: string,
): Promise<SecureShareLinkMaterial> {
  return createSecureShareLinkMaterialWithCrypto(
    vaultKey,
    vaultId,
    browserClientCryptoPort,
    async (value) => new Uint8Array(await crypto.subtle.digest("SHA-256", value.slice())),
  );
}
