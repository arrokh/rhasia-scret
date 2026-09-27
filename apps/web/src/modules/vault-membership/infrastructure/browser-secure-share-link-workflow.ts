"use client";

import type { PortableJsonWebKey } from "@rhasia-scret/client-vault-core";
import { browserAuthenticatedTransport } from "@/shared/infrastructure/browser-api-client";
import { redeemSecureShareLinkMaterial } from "./browser-secure-share-link-redemption";
import { redeemSecureShareLink as redeemWorkflow, SecureShareLinkHttpTransport } from "@rhasia-scret/client-vault-core";

const secureShareLinks = new SecureShareLinkHttpTransport(browserAuthenticatedTransport);

export function redeemSecureShareLink(
  secret: string,
  recipient: { profileId: string; publicKey: PortableJsonWebKey },
): Promise<void> {
  return redeemWorkflow(secret, recipient, {
    crypto: {
      digestSha256: async (value) => new Uint8Array(await crypto.subtle.digest("SHA-256", value.slice())),
      redeemMaterial: redeemSecureShareLinkMaterial,
    },
    transport: secureShareLinks,
  });
}
