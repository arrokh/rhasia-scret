export type VaultPurgeBatch = { purgedIds: string[] };

export interface ExpiredVaultRetentionRepository {
  purgeExpiredVaults(now: Date, batchSize: number): Promise<VaultPurgeBatch>;
}

export function purgeExpiredSharedVaults(
  repository: ExpiredVaultRetentionRepository,
  now: Date,
  batchSize: number,
): Promise<VaultPurgeBatch> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500)
    throw new Error("Vault retention purge batch size must be between 1 and 500.");
  return repository.purgeExpiredVaults(now, batchSize);
}
