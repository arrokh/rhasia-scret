export const ACCOUNT_RECOVERY_DAYS = 30;

export function accountPurgeAfter(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + ACCOUNT_RECOVERY_DAYS * 24 * 60 * 60 * 1000);
}
