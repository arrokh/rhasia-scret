export type VaultAuditFilter = { accountId?: string; actorUserId?: string };

export type RedactedVaultAuditEvent = {
  id: string;
  eventType: string;
  targetId: string | null;
  actorUserId: string;
  actorEmail: string;
  createdAt: Date;
};

export interface VaultAuditRepository {
  recordAccountAccess(actorUserId: string, vaultId: string, accountId: string): Promise<boolean>;
  listForOwner(ownerId: string, vaultId: string, filter: VaultAuditFilter): Promise<RedactedVaultAuditEvent[] | null>;
}

export function recordSharedVaultAccountAccess(actorUserId: string, vaultId: string, accountId: string, repository: VaultAuditRepository) {
  return repository.recordAccountAccess(actorUserId, vaultId, accountId);
}

export function listSharedVaultAuditForOwner(ownerId: string, vaultId: string, filter: VaultAuditFilter, repository: VaultAuditRepository) {
  return repository.listForOwner(ownerId, vaultId, filter);
}
