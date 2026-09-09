"use client";

import { browserApiClient } from "@/shared/infrastructure/browser-api-client";
import { redactedAuditAction, type RedactedAuditAction } from "../domain/vault-audit-event";

export type VaultAuditFilter = { accountId?: string; actorUserId?: string };
export type VaultAuditEvent = {
  id: string;
  eventType: RedactedAuditAction;
  targetId: string | null;
  actorUserId: string;
  actorEmail: string;
  createdAt: string;
};
export type VaultAuditPage = { events: VaultAuditEvent[]; nextCursor: string | null };

export async function loadVaultAuditEvents(
  vaultId: string,
  filter: VaultAuditFilter = {},
  cursor: string | null = null,
): Promise<VaultAuditPage> {
  const search = new URLSearchParams();
  if (filter.accountId) search.set("accountId", filter.accountId);
  if (filter.actorUserId) search.set("actorUserId", filter.actorUserId);
  if (cursor) search.set("cursor", cursor);
  const query = search.size ? `?${search.toString()}` : "";
  const response = await browserApiClient.getJson<{
    events: Array<Omit<VaultAuditEvent, "eventType"> & { eventType: string }>;
    nextCursor: string | null;
  }>(`/api/vaults/${encodeURIComponent(vaultId)}/audit-events${query}`, { cache: "no-store" });
  return {
    events: response.events
      .filter(
        (event) =>
          (!filter.accountId || event.targetId === filter.accountId) &&
          (!filter.actorUserId || event.actorUserId === filter.actorUserId),
      )
      .map((event) => ({ ...event, eventType: redactedAuditAction(event.eventType) })),
    nextCursor: response.nextCursor,
  };
}

export function recordSharedVaultAccountAccess(vaultId: string, accountId: string): Promise<void> {
  return browserApiClient.postEmpty(`/api/shared-vaults/${encodeURIComponent(vaultId)}/audit-events`, {
    eventType: "ACCOUNT_ACCESSED",
    accountId,
  });
}

export function recordVaultArchiveExport(vaultId: string): Promise<void> {
  return browserApiClient.postEmpty(`/api/vaults/${encodeURIComponent(vaultId)}/archive-exports`);
}

export function recordPersonalVaultAccountCopiesToLocal(vaultId: string, accountIds: string[]): Promise<void> {
  return browserApiClient.postEmpty(`/api/vaults/${encodeURIComponent(vaultId)}/audit-events`, {
    eventType: "ACCOUNT_COPIED_TO_LOCAL",
    accountIds,
  });
}
