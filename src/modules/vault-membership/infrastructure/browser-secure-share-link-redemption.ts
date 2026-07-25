"use client";

import { decryptPayload, deserializeEncryptedEnvelope, encryptPayload, serializeEncryptedEnvelope } from "@/modules/crypto";

export async function redeemSecureShareLinkMaterial(secret: string, encryptedPackage: Uint8Array, userRootKey: Uint8Array): Promise<{ linkVerifier: Uint8Array; encryptedVaultKey: Uint8Array }> {
  const linkVerifier = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)));
  const linkKey = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`shared-totp-vault:share-link:v1:${secret}`)));
  const vaultKey = await decryptPayload(linkKey, deserializeEncryptedEnvelope(encryptedPackage));
  return { linkVerifier, encryptedVaultKey: serializeEncryptedEnvelope(await encryptPayload(userRootKey, vaultKey)) };
}
