"use client";

import { browserApiClient } from "@/shared/infrastructure/browser-api-client";

export type BrowserVaultParticipant = {
  key: string;
  email: string;
  kind: "OWNER" | "MEMBER" | "INVITATION";
  userId: string | null;
  invitationId: string | null;
  invitedAt: string;
};

export type BrowserVaultParticipantPage = {
  owner: { id: string; email: string };
  participants: BrowserVaultParticipant[];
  nextCursor: string | null;
};

export function loadVaultParticipants(vaultId: string, cursor: string | null): Promise<BrowserVaultParticipantPage> {
  const search = new URLSearchParams();
  if (cursor) search.set("cursor", cursor);
  const query = search.size ? `?${search.toString()}` : "";
  return browserApiClient.getJson<BrowserVaultParticipantPage>(`/api/shared-vaults/${encodeURIComponent(vaultId)}/participants${query}`, { cache: "no-store" });
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
