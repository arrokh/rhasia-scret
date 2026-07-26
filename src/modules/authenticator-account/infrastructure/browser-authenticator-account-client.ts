"use client";

import { browserApiClient } from "@/shared/infrastructure/browser-api-client";

export type AuthenticatorAccountDestination = { vaultId: string; vaultType: "PERSONAL" | "SHARED" };

export function deleteEncryptedAuthenticatorAccount(
  destination: AuthenticatorAccountDestination,
  accountId: string,
  expectedRevision: number
): Promise<void> {
  return browserApiClient.deleteJsonEmpty(accountEndpoint(destination), { accountId, expectedRevision });
}

export function updateEncryptedAuthenticatorAccount(
  destination: AuthenticatorAccountDestination,
  request: { accountId: string; expectedRevision: number; encryptedPayload: string; encryptionVersion: number }
): Promise<{ id: string; revision: number }> {
  return browserApiClient.patchJson(accountEndpoint(destination), request);
}

export function createEncryptedAuthenticatorAccount(
  destination: AuthenticatorAccountDestination,
  request: { encryptedPayload: string; encryptionVersion: number }
): Promise<{ id: string; revision: number }> {
  return browserApiClient.postJson(accountEndpoint(destination), request);
}

function accountEndpoint(destination: AuthenticatorAccountDestination): string {
  return destination.vaultType === "PERSONAL"
    ? `/api/vaults/${destination.vaultId}/accounts`
    : `/api/shared-vaults/${destination.vaultId}/accounts`;
}
