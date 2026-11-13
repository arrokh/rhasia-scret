export type AuthStatePurgeResult = Readonly<{ count: number; backlogRemaining: boolean }>;

export interface ExpiredAuthStateRepository {
  purgeExpiredAuthState(now: Date, batchSize: number, maxBatches: number): Promise<AuthStatePurgeResult>;
}

export function purgeExpiredAuthState(
  repository: ExpiredAuthStateRepository,
  now: Date,
  batchSize: number,
  maxBatches: number,
): Promise<AuthStatePurgeResult> {
  return repository.purgeExpiredAuthState(now, batchSize, maxBatches);
}
