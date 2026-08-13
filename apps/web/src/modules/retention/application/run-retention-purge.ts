import { purgeExpiredAuthenticatorAccounts, type ExpiredAccountPurgeRepository } from "@/modules/authenticator-account/server";
import { purgeExpiredSharedVaults, purgeExpiredVaultAuditEvents, type ExpiredVaultRetentionRepository } from "@/modules/vault-management/server";

export type RetentionPurgeReport = {
  accountIds: string[];
  vaultIds: string[];
  auditEventIds: string[];
  accountBacklogRemaining: boolean;
  vaultBacklogRemaining: boolean;
  auditBacklogRemaining: boolean;
};

export async function runRetentionPurge({
  accounts,
  vaults,
  now,
  batchSize = 100,
  maxBatches = 10
}: {
  accounts: ExpiredAccountPurgeRepository;
  vaults: ExpiredVaultRetentionRepository;
  now: Date;
  batchSize?: number;
  maxBatches?: number;
}): Promise<RetentionPurgeReport> {
  if (!Number.isSafeInteger(maxBatches) || maxBatches < 1 || maxBatches > 20) throw new Error("Retention purge max batches must be between 1 and 20.");

  const accountResult = await drain((size) => purgeExpiredAuthenticatorAccounts(accounts, now, size), batchSize, maxBatches);
  const vaultResult = await drain((size) => purgeExpiredSharedVaults(vaults, now, size), batchSize, maxBatches);
  const auditResult = await drain((size) => purgeExpiredVaultAuditEvents(vaults, now, size), batchSize, maxBatches);
  return {
    accountIds: accountResult.ids,
    vaultIds: vaultResult.ids,
    auditEventIds: auditResult.ids,
    accountBacklogRemaining: accountResult.backlogRemaining,
    vaultBacklogRemaining: vaultResult.backlogRemaining,
    auditBacklogRemaining: auditResult.backlogRemaining
  };
}

async function drain(
  purge: (batchSize: number) => Promise<{ purgedIds: string[] }>,
  batchSize: number,
  maxBatches: number
): Promise<{ ids: string[]; backlogRemaining: boolean }> {
  const ids: string[] = [];
  let lastBatchSize = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const result = await purge(batchSize);
    lastBatchSize = result.purgedIds.length;
    ids.push(...result.purgedIds);
    if (lastBatchSize < batchSize) return { ids, backlogRemaining: false };
  }
  return { ids, backlogRemaining: lastBatchSize === batchSize };
}
