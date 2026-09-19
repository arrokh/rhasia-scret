import { PrismaExpiredVaultAuditRepository } from "./infrastructure/prisma-expired-vault-audit-repository";
import { PrismaVaultAuditRepository } from "./infrastructure/prisma-vault-audit-repository";
import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";

export {
  listVaultAuditForOwner,
  recordPersonalVaultAccountCopiesToLocal,
  recordSharedVaultAccountAccess,
  recordVaultArchiveExport,
} from "./application/manage-vault-audit";
export type {
  PersonalVaultCopyAuditRepository,
  RedactedVaultAuditEvent,
  VaultAuditFilter,
  VaultAuditRepository,
} from "./application/manage-vault-audit";
export { purgeExpiredVaultAuditEvents } from "./application/purge-expired-vault-audit-events";
export type { AuditPurgeBatch, ExpiredVaultAuditRepository } from "./application/purge-expired-vault-audit-events";
export type { VaultAuditAppender } from "./application/vault-audit-appender";
export { auditPurgeAfter } from "./domain/vault-audit-retention-policy";
export type { AuditAction, RedactedAuditAction, VaultAuditAppend } from "./domain/vault-audit-event";
export {
  appendVaultAuditEvent,
  PrismaTransactionalVaultAuditAppender,
  setVaultAuditRetention,
} from "./infrastructure/prisma-vault-audit-appender";

export function createVaultAuditRepository(database: PrismaDatabase): PrismaVaultAuditRepository {
  return new PrismaVaultAuditRepository(database);
}

export function createExpiredVaultAuditRepository(database: PrismaDatabase): PrismaExpiredVaultAuditRepository {
  return new PrismaExpiredVaultAuditRepository(database);
}
