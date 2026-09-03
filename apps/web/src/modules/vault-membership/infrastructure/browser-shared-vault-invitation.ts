"use client";

import { browserAuthenticatedTransport } from "@/shared/infrastructure/browser-api-client";
import { createSecureShareLink, SecureShareLinkHttpTransport } from "@rhasia-scret/client-vault-core";
import { createSecureShareLinkMaterial } from "./browser-secure-share-link";

const secureShareLinks = new SecureShareLinkHttpTransport(browserAuthenticatedTransport);

export function createSharedVaultInvitation(
  vaultId: string,
  recipientEmail: string,
  vaultKey: Uint8Array,
): Promise<{ id: string; secret: string; expiresAt: string }> {
  return createSecureShareLink(vaultId, recipientEmail, vaultKey, {
    crypto: { createMaterial: createSecureShareLinkMaterial },
    transport: secureShareLinks,
    delivery: { deliver: async () => undefined },
  });
}
