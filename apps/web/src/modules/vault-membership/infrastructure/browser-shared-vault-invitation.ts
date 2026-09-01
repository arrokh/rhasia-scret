"use client";

import { bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { browserAuthenticatedTransport } from "@/shared/infrastructure/browser-api-client";
import { createSecureShareLinkMaterial } from "./browser-secure-share-link";
import { SecureShareLinkHttpTransport } from "@rhasia-scret/client-vault-core";

const secureShareLinks = new SecureShareLinkHttpTransport(browserAuthenticatedTransport);

export async function createSharedVaultInvitation(vaultId: string, recipientEmail: string, vaultKey: Uint8Array): Promise<{ id: string; secret: string; expiresAt: string }> {
  const material = await createSecureShareLinkMaterial(vaultKey, vaultId);
  try {
    const invitation = await secureShareLinks.create(vaultId, {
      recipientEmail,
      linkVerifier: bytesToBase64(material.linkVerifier),
      encryptedPackage: bytesToBase64(material.encryptedPackage)
    });
    return { id: invitation.id, secret: material.secret, expiresAt: invitation.expiresAt };
  } finally {
    material.linkVerifier.fill(0);
    material.encryptedPackage.fill(0);
  }
}
