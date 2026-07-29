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
  vaultId?: string;
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

export type VaultAuditFilter = { accountId?: string; actorUserId?: string };
export type VaultAuditEvent = { id: string; eventType: string; targetId: string | null; actorUserId: string; actorEmail: string; createdAt: string };
export type VaultAuditPage = { events: VaultAuditEvent[]; nextCursor: string | null };

export async function loadVaultAuditEvents(vaultId: string, filter: VaultAuditFilter = {}, cursor: string | null = null): Promise<VaultAuditPage> {
  const search = new URLSearchParams();
  if (filter.accountId) search.set("accountId", filter.accountId);
  if (filter.actorUserId) search.set("actorUserId", filter.actorUserId);
  if (cursor) search.set("cursor", cursor);
  const query = search.size ? `?${search.toString()}` : "";
  const response = await browserApiClient.getJson<VaultAuditPage>(`/api/vaults/${encodeURIComponent(vaultId)}/audit-events${query}`, { cache: "no-store" });
  return {
    events: response.events.filter((event) => (!filter.accountId || event.targetId === filter.accountId) && (!filter.actorUserId || event.actorUserId === filter.actorUserId)),
    nextCursor: response.nextCursor
  };
}

export function recordSharedVaultAccountAccess(vaultId: string, accountId: string): Promise<void> {
  return browserApiClient.postEmpty(`/api/shared-vaults/${encodeURIComponent(vaultId)}/audit-events`, { eventType: "ACCOUNT_ACCESSED", accountId });
}

export function recordVaultArchiveExport(vaultId: string): Promise<void> {
  return browserApiClient.postEmpty(`/api/vaults/${encodeURIComponent(vaultId)}/archive-exports`);
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
