"use client";

import { browserApiClient } from "@/shared/infrastructure/browser-api-client";

export function createEncryptedAuthenticatorAccount(
  destination: { vaultId: string; vaultType: "PERSONAL" | "SHARED" },
  request: { encryptedPayload: string; encryptionVersion: number }
): Promise<void> {
  const endpoint = destination.vaultType === "PERSONAL"
    ? `/api/vaults/${destination.vaultId}/accounts`
    : `/api/shared-vaults/${destination.vaultId}/accounts`;
  return browserApiClient.postEmpty(endpoint, request);
}
