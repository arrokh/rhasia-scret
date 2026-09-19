export const VAULT_RECOVERY_DAYS = 30;

export function vaultPurgeAfter(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + VAULT_RECOVERY_DAYS * 24 * 60 * 60 * 1000);
}
