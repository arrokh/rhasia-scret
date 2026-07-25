"use client";

import { encryptPayload, generateSymmetricKey, serializeEncryptedEnvelope } from "@/modules/crypto";

export type SecureShareLinkMaterial = {
  secret: string;
  linkVerifier: Uint8Array;
  encryptedPackage: Uint8Array;
};

export async function createSecureShareLinkMaterial(vaultKey: Uint8Array): Promise<SecureShareLinkMaterial> {
  const secret = toBase64Url(generateSymmetricKey());
  const linkVerifier = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)));
  const linkKey = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`shared-totp-vault:share-link:v1:${secret}`)));
  return { secret, linkVerifier, encryptedPackage: serializeEncryptedEnvelope(await encryptPayload(linkKey, vaultKey)) };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
