export interface ExpiredAuthStateRepository {
  purgeExpiredAuthState(now: Date): Promise<number>;
}

export function purgeExpiredAuthState(repository: ExpiredAuthStateRepository, now: Date): Promise<number> {
  return repository.purgeExpiredAuthState(now);
}
