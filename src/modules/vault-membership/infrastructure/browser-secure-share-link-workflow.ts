"use client";

import { base64ToBytes, bytesToBase64, bytesToBase64Url } from "@/shared/infrastructure/browser-base64";
import { browserApiClient } from "@/shared/infrastructure/browser-api-client";
import { redeemSecureShareLinkMaterial } from "./browser-secure-share-link-redemption";

export async function redeemSecureShareLink(secret: string, userRootKey: Uint8Array): Promise<void> {
  const verifier = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)));
  const link = await browserApiClient.getJson<{ id: string; encryptedPackage: string }>(`/api/secure-share-links?verifier=${encodeURIComponent(bytesToBase64(verifier))}`, { cache: "no-store" });
  const material = await redeemSecureShareLinkMaterial(secret, base64ToBytes(link.encryptedPackage), userRootKey);
  if (bytesToBase64Url(material.linkVerifier) !== bytesToBase64Url(verifier)) throw new Error("Secure Share Link verifier mismatch.");
  await browserApiClient.postEmpty("/api/secure-share-links", { invitationId: link.id, encryptedVaultKey: bytesToBase64(material.encryptedVaultKey), keyVersion: 1 });
}
