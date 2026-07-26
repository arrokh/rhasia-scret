export type AccountPurgeBatch = {
  purgedIds: string[];
};

export interface ExpiredAccountPurgeRepository {
  purgeExpired(now: Date, batchSize: number): Promise<AccountPurgeBatch>;
}

export function purgeExpiredAuthenticatorAccounts(
  repository: ExpiredAccountPurgeRepository,
  now: Date,
  batchSize: number
): Promise<AccountPurgeBatch> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new Error("Account purge batch size must be between 1 and 500.");
  return repository.purgeExpired(now, batchSize);
}
