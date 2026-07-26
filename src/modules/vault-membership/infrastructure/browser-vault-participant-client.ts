"use client";

import { browserApiClient } from "@/shared/infrastructure/browser-api-client";

export type BrowserVaultParticipant = {
  key: string;
  email: string;
  kind: "OWNER" | "MEMBER" | "INVITATION";
  userId: string | null;
  invitationId: string | null;
  invitedAt: string | null;
};

export async function loadVaultParticipants(vaultId: string): Promise<BrowserVaultParticipant[]> {
  const response = await browserApiClient.getJson<{ participants: BrowserVaultParticipant[] }>(`/api/shared-vaults/${encodeURIComponent(vaultId)}/participants`, { cache: "no-store" });
  return response.participants;
}

export function deleteVaultParticipant(vaultId: string, participant: BrowserVaultParticipant): Promise<void> {
  if (participant.kind === "MEMBER" && participant.userId) {
    return browserApiClient.deleteEmpty(`/api/shared-vaults/${encodeURIComponent(vaultId)}/members/${encodeURIComponent(participant.userId)}`);
  }
  if (participant.kind === "INVITATION" && participant.invitationId) {
    return browserApiClient.deleteEmpty(`/api/shared-vaults/${encodeURIComponent(vaultId)}/share-links/${encodeURIComponent(participant.invitationId)}`);
  }
  return Promise.reject(new Error("Vault owner cannot be removed."));
}
