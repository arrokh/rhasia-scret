export type VaultPurgeBatch = { purgedIds: string[] };
export type AuditPurgeBatch = { purgedIds: string[] };

export interface ExpiredVaultRetentionRepository {
  purgeExpiredVaults(now: Date, batchSize: number): Promise<VaultPurgeBatch>;
  purgeExpiredAuditEvents(now: Date, batchSize: number): Promise<AuditPurgeBatch>;
}

export function purgeExpiredSharedVaults(repository: ExpiredVaultRetentionRepository, now: Date, batchSize: number): Promise<VaultPurgeBatch> {
  validateBatchSize(batchSize);
  return repository.purgeExpiredVaults(now, batchSize);
}

export function purgeExpiredVaultAuditEvents(repository: ExpiredVaultRetentionRepository, now: Date, batchSize: number): Promise<AuditPurgeBatch> {
  validateBatchSize(batchSize);
  return repository.purgeExpiredAuditEvents(now, batchSize);
}

function validateBatchSize(batchSize: number): void {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new Error("Vault retention purge batch size must be between 1 and 500.");
}
