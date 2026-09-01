"use client";

import { browserAuthenticatedTransport } from "@/shared/infrastructure/browser-api-client";
import { AuthorizedOfflineBundleTransport, type EncryptedOfflineVaultBundle } from "@rhasia-scret/client-vault-core";

const offlineBundles = new AuthorizedOfflineBundleTransport(browserAuthenticatedTransport);

export async function fetchAuthorizedOfflineBundle(cached: EncryptedOfflineVaultBundle | null = null): Promise<EncryptedOfflineVaultBundle> {
  return offlineBundles.fetch(cached);
}
