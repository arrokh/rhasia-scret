export const VAULT_AUDIT_ACTIONS = [
  "VAULT_CREATED",
  "ACCOUNT_ADDED",
  "ACCOUNT_UPDATED",
  "ACCOUNT_DELETED",
  "ACCOUNT_RESTORED",
  "MEMBER_REVOKED",
  "MEMBER_PERMISSIONS_UPDATED",
  "VAULT_MEMBER_DEFAULT_PERMISSIONS_UPDATED",
  "ACCOUNT_ACCESSED",
  "ACCOUNT_COPIED_FROM_LOCAL",
  "ACCOUNT_COPIED_TO_LOCAL",
  "ARCHIVE_EXPORTED",
  "ARCHIVE_IMPORTED",
  "VAULT_DELETED",
  "VAULT_RESTORED",
] as const;

export type AuditAction = (typeof VAULT_AUDIT_ACTIONS)[number];
export type RedactedAuditAction = AuditAction | "UNKNOWN_SECURITY_ACTIVITY";

export type VaultAuditAppend = {
  vaultId: string;
  ownerId: string;
  actorUserId: string;
  action: AuditAction;
  targetId?: string;
  retentionPurgeAfter?: Date;
};

export function isAuditAction(value: string): value is AuditAction {
  return (VAULT_AUDIT_ACTIONS as readonly string[]).includes(value);
}

export function redactedAuditAction(value: string): RedactedAuditAction {
  return isAuditAction(value) ? value : "UNKNOWN_SECURITY_ACTIVITY";
}
