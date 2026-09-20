import { createExpiredVaultAuditRepository } from "@api/modules/audit/server";
import { createExpiredAccountPurgeRepository } from "@api/modules/authenticator-account/server";
import { createExpiredVaultRetentionRepository } from "@api/modules/vault-management/server";
import { PrismaAuthRetentionRepository } from "./infrastructure/prisma-auth-retention-repository";
import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";
import { runRetentionPurge } from "./application/run-retention-purge";

export { runRetentionPurge, type RetentionPurgeReport } from "./application/run-retention-purge";

export function createRetentionPurgeService(database: PrismaDatabase) {
  const accounts = createExpiredAccountPurgeRepository(database);
  const vaults = createExpiredVaultRetentionRepository(database);
  const audit = createExpiredVaultAuditRepository(database);
  const auth = new PrismaAuthRetentionRepository(database);
  return (now: Date) => runRetentionPurge({ accounts, vaults, audit, auth, now });
}
