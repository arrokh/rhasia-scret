"use client";

import { browserApiClient } from "@/shared/infrastructure/browser-api-client";

export function deleteEncryptedAuthenticatorAccount(vaultId: string, accountId: string, expectedRevision: number): Promise<void> {
  return browserApiClient.deleteJsonEmpty(`/api/shared-vaults/${vaultId}/accounts`, { accountId, expectedRevision });
}

export function createEncryptedAuthenticatorAccount(
  destination: { vaultId: string; vaultType: "PERSONAL" | "SHARED" },
  request: { encryptedPayload: string; encryptionVersion: number }
): Promise<{ id: string; revision: number }> {
  const endpoint = destination.vaultType === "PERSONAL"
    ? `/api/vaults/${destination.vaultId}/accounts`
    : `/api/shared-vaults/${destination.vaultId}/accounts`;
  return browserApiClient.postJson(endpoint, request);
}
