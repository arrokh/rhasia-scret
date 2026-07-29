"use client";

import { decryptPayloadWithContext, deserializeEncryptedEnvelope, encryptPayloadWithContext, serializeEncryptedEnvelope } from "@/modules/crypto";

export async function redeemSecureShareLinkMaterial(secret: string, encryptedPackage: Uint8Array, userRootKey: Uint8Array, vaultId?: string): Promise<{ linkVerifier: Uint8Array; encryptedVaultKey: Uint8Array }> {
  const linkVerifier = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)));
  const linkKey = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`shared-totp-vault:share-link:v1:${secret}`)));
  try {
    const vaultKey = await decryptPayloadWithContext(linkKey, deserializeEncryptedEnvelope(encryptedPackage), { purpose: "secure-share-link", payloadType: "vault-encryption-key", ...(vaultId ? { vaultId } : {}), keyVersion: 1 });
    try {
      return { linkVerifier, encryptedVaultKey: serializeEncryptedEnvelope(await encryptPayloadWithContext(userRootKey, vaultKey, { purpose: "vault-key-wrap", payloadType: "vault-encryption-key", ...(vaultId ? { vaultId } : {}), keyVersion: 1 })) };
    } finally {
      vaultKey.fill(0);
    }
  } finally {
    linkKey.fill(0);
  }
}
