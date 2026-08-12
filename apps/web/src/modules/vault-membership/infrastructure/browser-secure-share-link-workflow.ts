"use client";

import { browserApiClient } from "@/shared/infrastructure/browser-api-client";
import { redeemSecureShareLinkMaterial } from "./browser-secure-share-link-redemption";
import { redeemSecureShareLink as redeemWorkflow } from "@rhasia-scret/client-vault-core";

export function redeemSecureShareLink(secret: string, userRootKey: Uint8Array): Promise<void> {
  return redeemWorkflow(secret, userRootKey, {
    crypto: {
      digestSha256: async (value) => new Uint8Array(await crypto.subtle.digest("SHA-256", value.slice())),
      redeemMaterial: redeemSecureShareLinkMaterial
    },
    transport: {
      lookup: (verifier) => browserApiClient.getJson(`/api/secure-share-links?verifier=${encodeURIComponent(verifier)}`, { cache: "no-store" }),
      redeem: (request) => browserApiClient.postEmpty("/api/secure-share-links", request)
    }
  });
}
