"use client";

import { browserApiClient } from "@/shared/infrastructure/browser-api-client";

export type PersonalVaultInitializationRequest = {
  vaultUnlockSalt: string;
  wrappedUserRootKey: string;
  encryptedPersonalVaultKey: string;
  encryptedVaultName: string;
  encryptionVersion: number;
};

export type SharedVaultCreationRequest = {
  encryptedName: string;
  encryptedOwnerVaultKey: string;
  encryptionVersion: number;
};

export type DestructiveResetResult =
  | { status: "reset" }
  | { status: "invalid_confirmation" }
  | { status: "owned_shared_vaults_exist"; count: number }
  | { status: "passkey_recovery_available" };

export function initializePersonalVault(request: PersonalVaultInitializationRequest): Promise<void> {
  return browserApiClient.postEmpty("/api/personal-vault/initialize", request);
}

export function createSharedVault(request: SharedVaultCreationRequest): Promise<{ id: string }> {
  return browserApiClient.postJson("/api/shared-vaults", request);
}

export function renameSharedVault(vaultId: string, encryptedName: string): Promise<void> {
  return browserApiClient.patchEmpty(`/api/shared-vaults/${vaultId}`, { encryptedName, encryptionVersion: 1 });
}

export function deleteSharedVault(vaultId: string): Promise<void> {
  return browserApiClient.deleteEmpty(`/api/shared-vaults/${vaultId}/lifecycle`);
}

export async function destructivelyResetPersonalVault(confirmation: string): Promise<DestructiveResetResult> {
  const response = await browserApiClient.post("/api/personal-vault/destructive-reset", { confirmation });
  if (response.ok) return { status: "reset" };
  const error = await parseResetError(response);
  if (error.error === "invalid_confirmation") return { status: "invalid_confirmation" };
  if (error.error === "owned_shared_vaults_exist") return { status: "owned_shared_vaults_exist", count: error.count ?? 0 };
  if (error.error === "passkey_recovery_available") return { status: "passkey_recovery_available" };
  throw new Error("Destructive reset failed.");
}

async function parseResetError(response: Response): Promise<{ error?: string; count?: number }> {
  try {
    return await response.json() as { error?: string; count?: number };
  } catch {
    return {};
  }
}
