"use client";

import { browserApiClient } from "@/shared/infrastructure/browser-api-client";
import { parseEncryptedOfflineVaultBundle, type EncryptedOfflineVaultBundle } from "@rhasia-scret/client-vault-core";

export async function fetchAuthorizedOfflineBundle(cached: EncryptedOfflineVaultBundle | null = null): Promise<EncryptedOfflineVaultBundle> {
  const headers = new Headers();
  if (cached) headers.set("if-none-match", `"${cached.synchronizationToken}"`);
  const response = await browserApiClient.request("/api/sync/offline-bundle", { method: "GET", cache: "no-store", headers });
  if (response.status === 304) {
    if (!cached) throw new Error("The server returned an unchanged synchronization bundle without a Local Vault Snapshot.");
    const synchronizedAt = response.headers.get("x-synchronized-at");
    return parseEncryptedOfflineVaultBundle({ ...cached, synchronizedAt: synchronizedAt ?? cached.synchronizedAt });
  }
  return parseEncryptedOfflineVaultBundle(await browserApiClient.readJsonResponse<unknown>(response));
}
