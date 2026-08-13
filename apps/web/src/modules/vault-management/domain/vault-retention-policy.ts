export const VAULT_RECOVERY_DAYS = 30;

export function vaultPurgeAfter(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + VAULT_RECOVERY_DAYS * 24 * 60 * 60 * 1000);
}

export function auditPurgeAfter(vaultDeletedAt: Date): Date {
  const deadline = new Date(vaultDeletedAt);
  deadline.setUTCFullYear(deadline.getUTCFullYear() + 1);
  return deadline;
}
