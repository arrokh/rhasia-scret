import type { CursorPage, CursorPageRequest } from "@/shared/application/cursor-page";
import type { RedactedAuditAction } from "../domain/vault-audit-event";

export type VaultAuditFilter = { accountId?: string; actorUserId?: string };

export type RedactedVaultAuditEvent = {
  id: string;
  eventType: RedactedAuditAction;
  targetId: string | null;
  actorUserId: string;
  actorEmail: string;
  createdAt: Date;
};

export interface VaultAuditRepository {
  recordAccountAccess(actorUserId: string, vaultId: string, accountId: string): Promise<boolean>;
  recordArchiveExport(ownerId: string, vaultId: string): Promise<boolean>;
  listForOwner(ownerId: string, vaultId: string, filter: VaultAuditFilter, request: CursorPageRequest): Promise<CursorPage<RedactedVaultAuditEvent> | null>;
}

export function recordSharedVaultAccountAccess(actorUserId: string, vaultId: string, accountId: string, repository: VaultAuditRepository) {
  return repository.recordAccountAccess(actorUserId, vaultId, accountId);
}

export function recordVaultArchiveExport(ownerId: string, vaultId: string, repository: VaultAuditRepository) {
  return repository.recordArchiveExport(ownerId, vaultId);
}

export interface PersonalVaultCopyAuditRepository {
  recordPersonalAccountCopiesToLocal(ownerId: string, vaultId: string, accountIds: string[]): Promise<boolean>;
}

export function recordPersonalVaultAccountCopiesToLocal(ownerId: string, vaultId: string, accountIds: string[], repository: PersonalVaultCopyAuditRepository) {
  return repository.recordPersonalAccountCopiesToLocal(ownerId, vaultId, accountIds);
}

export function listVaultAuditForOwner(ownerId: string, vaultId: string, filter: VaultAuditFilter, request: CursorPageRequest, repository: VaultAuditRepository) {
  return repository.listForOwner(ownerId, vaultId, filter, request);
}
