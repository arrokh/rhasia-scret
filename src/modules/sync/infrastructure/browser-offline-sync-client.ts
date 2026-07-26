"use client";

import { browserApiClient } from "@/shared/infrastructure/browser-api-client";
import { parseEncryptedOfflineVaultBundle, type EncryptedOfflineVaultBundle } from "../domain/offline-vault-bundle";

export async function fetchAuthorizedOfflineBundle(): Promise<EncryptedOfflineVaultBundle> {
  const response = await browserApiClient.getJson<unknown>("/api/sync/offline-bundle", { cache: "no-store" });
  return parseEncryptedOfflineVaultBundle(response);
}
