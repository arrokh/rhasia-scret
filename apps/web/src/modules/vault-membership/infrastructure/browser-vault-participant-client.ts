"use client";

import { browserApiClient, browserAuthenticatedTransport } from "@/shared/infrastructure/browser-api-client";
import type {
  EffectiveSharedVaultAccountPermissions,
  SharedVaultAccountPermissionOverrides,
  SharedVaultAccountPermissions
} from "@rhasia-scret/client-vault-core";
import { SecureShareLinkHttpTransport } from "@rhasia-scret/client-vault-core";

const secureShareLinks = new SecureShareLinkHttpTransport(browserAuthenticatedTransport);

export type BrowserVaultParticipant = {
  key: string;
  email: string;
  kind: "OWNER" | "MEMBER" | "INVITATION";
  userId: string | null;
  invitationId: string | null;
  invitationState: "PENDING" | "EXPIRED" | null;
  invitedAt: string;
  expiresAt: string | null;
  permissionOverrides: SharedVaultAccountPermissionOverrides | null;
  effectiveAccountPermissions: EffectiveSharedVaultAccountPermissions | null;
  permissionsRevision: number | null;
};

export type BrowserVaultParticipantPage = {
  owner: { id: string; email: string };
  vaultDefaultAccountPermissions: SharedVaultAccountPermissions;
  vaultDefaultAccountPermissionsRevision: number;
  participants: BrowserVaultParticipant[];
  nextCursor: string | null;
};

export function loadVaultParticipants(vaultId: string, cursor: string | null): Promise<BrowserVaultParticipantPage> {
  const search = new URLSearchParams();
  if (cursor) search.set("cursor", cursor);
  const query = search.size ? `?${search.toString()}` : "";
  return browserApiClient.getJson<BrowserVaultParticipantPage>(`/api/shared-vaults/${encodeURIComponent(vaultId)}/participants${query}`, { cache: "no-store" });
}

export function loadVaultDefaultAccountPermissions(vaultId: string): Promise<{
  vaultDefaultAccountPermissions: SharedVaultAccountPermissions;
  vaultDefaultAccountPermissionsRevision: number;
}> {
  return browserApiClient.getJson(`/api/shared-vaults/${encodeURIComponent(vaultId)}/member-permissions`, { cache: "no-store" });
}

export function updateVaultDefaultAccountPermissions(
  vaultId: string,
  expectedRevision: number,
  permissions: SharedVaultAccountPermissions
): Promise<{ vaultDefaultAccountPermissions: SharedVaultAccountPermissions; vaultDefaultAccountPermissionsRevision: number }> {
  return browserApiClient.patchJson(`/api/shared-vaults/${encodeURIComponent(vaultId)}/member-permissions`, {
    expectedRevision,
    ...permissions
  });
}

export function updateVaultMemberAccountPermissionOverrides(
  vaultId: string,
  memberUserId: string,
  expectedRevision: number,
  overrides: SharedVaultAccountPermissionOverrides
): Promise<{
  permissionOverrides: SharedVaultAccountPermissionOverrides;
  effectiveAccountPermissions: EffectiveSharedVaultAccountPermissions;
  permissionsRevision: number;
}> {
  return browserApiClient.patchJson(`/api/shared-vaults/${encodeURIComponent(vaultId)}/members/${encodeURIComponent(memberUserId)}`, {
    expectedRevision,
    ...overrides
  });
}

export function deleteVaultParticipant(vaultId: string, participant: BrowserVaultParticipant): Promise<void> {
  if (participant.kind === "MEMBER" && participant.userId) {
    return browserApiClient.deleteEmpty(`/api/shared-vaults/${encodeURIComponent(vaultId)}/members/${encodeURIComponent(participant.userId)}`);
  }
  if (participant.kind === "INVITATION" && participant.invitationId) {
    return secureShareLinks.cancel(vaultId, participant.invitationId);
  }
  return Promise.reject(new Error("Vault owner cannot be removed."));
}
