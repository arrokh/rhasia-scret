"use client";

import { bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { browserApiClient } from "@/shared/infrastructure/browser-api-client";
import { createSecureShareLinkMaterial } from "./browser-secure-share-link";

export async function createSharedVaultInvitation(vaultId: string, recipientEmail: string, vaultKey: Uint8Array): Promise<{ id: string; secret: string; expiresAt: string }> {
  const material = await createSecureShareLinkMaterial(vaultKey, vaultId);
  const invitation = await browserApiClient.postJson<{ id: string; expiresAt: string }>(`/api/shared-vaults/${encodeURIComponent(vaultId)}/share-links`, {
    recipientEmail: recipientEmail.trim().toLowerCase(),
    linkVerifier: bytesToBase64(material.linkVerifier),
    encryptedPackage: bytesToBase64(material.encryptedPackage)
  });
  return { id: invitation.id, secret: material.secret, expiresAt: invitation.expiresAt };
}
