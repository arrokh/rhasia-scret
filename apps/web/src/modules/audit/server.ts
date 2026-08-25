import { PrismaExpiredVaultAuditRepository } from "./infrastructure/prisma-expired-vault-audit-repository";
import { PrismaVaultAuditRepository } from "./infrastructure/prisma-vault-audit-repository";

export {
  listVaultAuditForOwner,
  recordPersonalVaultAccountCopiesToLocal,
  recordSharedVaultAccountAccess,
  recordVaultArchiveExport
} from "./application/manage-vault-audit";
export type {
  PersonalVaultCopyAuditRepository,
  RedactedVaultAuditEvent,
  VaultAuditFilter,
  VaultAuditRepository
} from "./application/manage-vault-audit";
export { purgeExpiredVaultAuditEvents } from "./application/purge-expired-vault-audit-events";
export type { AuditPurgeBatch, ExpiredVaultAuditRepository } from "./application/purge-expired-vault-audit-events";
export type { VaultAuditAppender } from "./application/vault-audit-appender";
export { auditPurgeAfter } from "./domain/vault-audit-retention-policy";
export type { AuditAction, RedactedAuditAction, VaultAuditAppend } from "./domain/vault-audit-event";
export { appendVaultAuditEvent, PrismaTransactionalVaultAuditAppender, setVaultAuditRetention } from "./infrastructure/prisma-vault-audit-appender";

export function createVaultAuditRepository(): PrismaVaultAuditRepository {
  return new PrismaVaultAuditRepository();
}

export function createExpiredVaultAuditRepository(): PrismaExpiredVaultAuditRepository {
  return new PrismaExpiredVaultAuditRepository();
}
