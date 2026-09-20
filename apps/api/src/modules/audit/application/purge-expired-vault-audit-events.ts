export type AuditPurgeBatch = { purgedIds: string[] };

export interface ExpiredVaultAuditRepository {
  purgeExpiredAuditEvents(now: Date, batchSize: number): Promise<AuditPurgeBatch>;
}

export function purgeExpiredVaultAuditEvents(
  repository: ExpiredVaultAuditRepository,
  now: Date,
  batchSize: number,
): Promise<AuditPurgeBatch> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500)
    throw new Error("Vault Audit History purge batch size must be between 1 and 500.");
  return repository.purgeExpiredAuditEvents(now, batchSize);
}
