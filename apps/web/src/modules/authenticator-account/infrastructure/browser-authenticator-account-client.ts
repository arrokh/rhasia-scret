"use client";

import { HostedAuthenticatorAccountTransport, type HostedAuthenticatorAccountDestination } from "@rhasia-scret/client-vault-core";
import { browserAuthenticatedTransport } from "@/shared/infrastructure/browser-api-client";

export type AuthenticatorAccountDestination = HostedAuthenticatorAccountDestination;

const hostedAccounts = new HostedAuthenticatorAccountTransport(browserAuthenticatedTransport);

export function deleteEncryptedAuthenticatorAccount(
  destination: AuthenticatorAccountDestination,
  accountId: string,
  expectedRevision: number
): Promise<void> {
  return hostedAccounts.delete(destination, { accountId, expectedRevision });
}

export function updateEncryptedAuthenticatorAccount(
  destination: AuthenticatorAccountDestination,
  request: { accountId: string; expectedRevision: number; encryptedPayload: string; encryptionVersion: 1 }
): Promise<{ id: string; revision: number }> {
  return hostedAccounts.update(destination, request);
}

export function createEncryptedAuthenticatorAccount(
  destination: AuthenticatorAccountDestination,
  request: { encryptedPayload: string; encryptionVersion: 1; source?: "LOCAL_VAULT_COPY" }
): Promise<{ id: string; revision: number }> {
  return hostedAccounts.create(destination, request);
}
