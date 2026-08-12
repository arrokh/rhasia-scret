"use client";

import { browserClientCryptoPort } from "@/modules/crypto";
import {
  createSecureShareLinkMaterialWithCrypto,
  type SecureShareLinkMaterial,
} from "../application/create-secure-share-link-material";

export type { SecureShareLinkMaterial };

export function createSecureShareLinkMaterial(vaultKey: Uint8Array, vaultId?: string): Promise<SecureShareLinkMaterial> {
  return createSecureShareLinkMaterialWithCrypto(
    vaultKey,
    vaultId,
    browserClientCryptoPort,
    async (value) => new Uint8Array(await crypto.subtle.digest("SHA-256", value.slice())),
  );
}
