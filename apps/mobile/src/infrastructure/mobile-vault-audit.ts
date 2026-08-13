import type { AuthenticatedTransport } from "@rhasia-scret/client-vault-core";

export type MobileVaultAuditEvent = {
  id: string;
  eventType: string;
  targetId: string | null;
  actorUserId: string;
  actorEmail: string;
  createdAt: string;
};

export async function loadMobileVaultAuditEvents(vaultId: string, transport: AuthenticatedTransport): Promise<MobileVaultAuditEvent[]> {
  const response = await transport.request({
    url: `/api/shared-vaults/${encodeURIComponent(vaultId)}/audit-events`,
    method: "GET",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Shared Vault audit history is unavailable.");
  const value = await response.json<unknown>();
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.events)) invalid();
  return record.events.map(parseEvent);
}

function parseEvent(value: unknown): MobileVaultAuditEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.eventType !== "string" || (record.targetId !== null && typeof record.targetId !== "string") || typeof record.actorUserId !== "string" || typeof record.actorEmail !== "string" || typeof record.createdAt !== "string" || !Number.isFinite(new Date(record.createdAt).getTime())) invalid();
  return record as MobileVaultAuditEvent;
}

function invalid(): never {
  throw new Error("Shared Vault audit history response is invalid.");
}
