export function auditPurgeAfter(vaultDeletedAt: Date): Date {
  const deadline = new Date(vaultDeletedAt);
  deadline.setUTCFullYear(deadline.getUTCFullYear() + 1);
  return deadline;
}
