import { createExpiredVaultAuditRepository } from "@/modules/audit/server";
import { createExpiredAccountPurgeRepository } from "@/modules/authenticator-account/server";
import { createExpiredVaultRetentionRepository } from "@/modules/vault-management/server";
import { PrismaAuthRetentionRepository } from "./infrastructure/prisma-auth-retention-repository";
import { runRetentionPurge } from "./application/run-retention-purge";

export { runRetentionPurge, type RetentionPurgeReport } from "./application/run-retention-purge";

export function createRetentionPurgeService() {
  const accounts = createExpiredAccountPurgeRepository();
  const vaults = createExpiredVaultRetentionRepository();
  const audit = createExpiredVaultAuditRepository();
  const auth = new PrismaAuthRetentionRepository();
  return (now: Date) => runRetentionPurge({ accounts, vaults, audit, auth, now });
}
