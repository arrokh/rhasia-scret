"use client";

import {
  BrowserApiError,
  browserAuthenticatedTransport,
  browserApiClient,
} from "@/shared/infrastructure/browser-api-client";
import type {
  CancellationPort,
  EncryptedPayloadMigrationCommit,
  EncryptedPayloadMigrationCommitResult,
  PortableJsonWebKey,
} from "@rhasia-scret/client-vault-core";
import { commitEncryptedPayloadMigrationTransport } from "@rhasia-scret/client-vault-core";

export type PersonalVaultInitializationRequest = {
  vaultUnlockSalt: string;
  wrappedUserRootKey: string;
  encryptedPersonalVaultKey: string;
  encryptedVaultName: string;
  userEncryptionPublicKey: PortableJsonWebKey;
  encryptedUserPrivateKey: string;
  userEncryptionKeyVersion: number;
  encryptionVersion: number;
};

export type SharedVaultCreationRequest = {
  vaultId?: string;
  encryptedName: string;
  encryptedOwnerVaultKey: string;
  expectedOwnerPublicKey: PortableJsonWebKey;
  encryptionVersion: number;
};

export type DestructiveResetResult =
  | { status: "reset" }
  | { status: "invalid_confirmation" }
  | { status: "owned_shared_vaults_exist"; count: number }
  | { status: "passkey_recovery_available" };

export type PersonalVaultInitializationFailureCategory =
  | "invalid_request"
  | "unauthenticated"
  | "forbidden"
  | "conflict"
  | "rate_limited"
  | "server_error"
  | "unexpected_response"
  | "transport_error";

export class PersonalVaultInitializationError extends Error {
  public constructor(public readonly category: PersonalVaultInitializationFailureCategory) {
    super("Personal Vault initialization failed.");
    this.name = "PersonalVaultInitializationError";
  }
}

export async function initializePersonalVault(request: PersonalVaultInitializationRequest): Promise<void> {
  try {
    await browserApiClient.postEmpty("/api/v1/personal-vault/initialize", request);
  } catch (error) {
    throw new PersonalVaultInitializationError(
      error instanceof BrowserApiError ? initializationFailureCategoryForStatus(error.status) : "transport_error",
    );
  }
}

function initializationFailureCategoryForStatus(status: number): PersonalVaultInitializationFailureCategory {
  if (status === 400 || status === 422) return "invalid_request";
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "unexpected_response";
}

export function createSharedVault(request: SharedVaultCreationRequest): Promise<{ id: string }> {
  return browserApiClient.postJson("/api/v1/shared-vaults", request);
}

export function migratePersonalVaultName(
  vaultId: string,
  expectedKeyVersion: number,
  migration: EncryptedPayloadMigrationCommit,
  signal?: CancellationPort,
): Promise<EncryptedPayloadMigrationCommitResult> {
  return commitEncryptedPayloadMigrationTransport(
    browserAuthenticatedTransport,
    "/v1/personal-vault/name/migration",
    { vaultId, expectedKeyVersion },
    migration,
    signal,
  );
}

export function migrateSharedVaultName(
  vaultId: string,
  expectedKeyVersion: number,
  migration: EncryptedPayloadMigrationCommit,
  signal?: CancellationPort,
): Promise<EncryptedPayloadMigrationCommitResult> {
  return commitEncryptedPayloadMigrationTransport(
    browserAuthenticatedTransport,
    `/v1/shared-vaults/${encodeURIComponent(vaultId)}/name/migration`,
    { expectedKeyVersion },
    migration,
    signal,
  );
}

export function migrateSharedVaultKeyWrap(
  vaultId: string,
  expectedKeyVersion: number,
  migration: EncryptedPayloadMigrationCommit,
  signal?: CancellationPort,
): Promise<EncryptedPayloadMigrationCommitResult> {
  return commitEncryptedPayloadMigrationTransport(
    browserAuthenticatedTransport,
    `/v1/shared-vaults/${encodeURIComponent(vaultId)}/key-wrap/migration`,
    { expectedKeyVersion },
    migration,
    signal,
  );
}

export function migratePersonalAuthenticatorAccount(
  vaultId: string,
  accountId: string,
  expectedRevision: number,
  expectedKeyVersion: number,
  migration: EncryptedPayloadMigrationCommit,
  signal?: CancellationPort,
): Promise<EncryptedPayloadMigrationCommitResult> {
  return commitEncryptedPayloadMigrationTransport(
    browserAuthenticatedTransport,
    `/v1/vaults/${encodeURIComponent(vaultId)}/accounts/migration`,
    { accountId, expectedRevision, expectedKeyVersion },
    migration,
    signal,
  );
}

export function migrateSharedAuthenticatorAccount(
  vaultId: string,
  accountId: string,
  expectedRevision: number,
  expectedKeyVersion: number,
  migration: EncryptedPayloadMigrationCommit,
  signal?: CancellationPort,
): Promise<EncryptedPayloadMigrationCommitResult> {
  return commitEncryptedPayloadMigrationTransport(
    browserAuthenticatedTransport,
    `/v1/shared-vaults/${encodeURIComponent(vaultId)}/accounts/migration`,
    { accountId, expectedRevision, expectedKeyVersion },
    migration,
    signal,
  );
}

export function renameSharedVault(vaultId: string, encryptedName: string, expectedKeyVersion: number): Promise<void> {
  return browserApiClient.patchEmpty(`/api/v1/shared-vaults/${vaultId}`, {
    encryptedName,
    encryptionVersion: 1,
    expectedKeyVersion,
  });
}

export function deleteSharedVault(vaultId: string): Promise<void> {
  return browserApiClient.deleteEmpty(`/api/v1/shared-vaults/${vaultId}/lifecycle`);
}

export async function destructivelyResetPersonalVault(confirmation: string): Promise<DestructiveResetResult> {
  const response = await browserApiClient.post("/api/v1/personal-vault/destructive-reset", { confirmation });
  if (response.ok) return { status: "reset" };
  const error = await parseResetError(response);
  if (error.error === "invalid_confirmation") return { status: "invalid_confirmation" };
  if (error.error === "owned_shared_vaults_exist")
    return { status: "owned_shared_vaults_exist", count: error.count ?? 0 };
  if (error.error === "passkey_recovery_available") return { status: "passkey_recovery_available" };
  throw new Error("Destructive reset failed.");
}

async function parseResetError(response: Response): Promise<{ error?: string; count?: number }> {
  try {
    return (await response.json()) as { error?: string; count?: number };
  } catch {
    return {};
  }
}
