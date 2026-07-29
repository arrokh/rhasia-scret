"use client";

import { encryptPayloadWithContext, generateSymmetricKey, serializeEncryptedEnvelope } from "@/modules/crypto";
import { bytesToBase64Url } from "@/shared/infrastructure/browser-base64";

export type SecureShareLinkMaterial = {
  secret: string;
  linkVerifier: Uint8Array;
  encryptedPackage: Uint8Array;
};

export async function createSecureShareLinkMaterial(vaultKey: Uint8Array, vaultId?: string): Promise<SecureShareLinkMaterial> {
  const secret = bytesToBase64Url(generateSymmetricKey());
  const linkVerifier = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)));
  const linkKey = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`shared-totp-vault:share-link:v1:${secret}`)));
  try {
    return { secret, linkVerifier, encryptedPackage: serializeEncryptedEnvelope(await encryptPayloadWithContext(linkKey, vaultKey, { purpose: "secure-share-link", payloadType: "vault-encryption-key", ...(vaultId ? { vaultId } : {}), keyVersion: 1 })) };
  } finally {
    linkKey.fill(0);
  }
}
