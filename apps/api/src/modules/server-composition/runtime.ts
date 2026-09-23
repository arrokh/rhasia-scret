import type { ApiBindings } from "@api/types";
import { createApplicationRateLimitCheckerForDatabase } from "@api/modules/rate-limiting/server";
import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";
import { createAccountDeletionRepository, type AccountDeletionRepository } from "@api/modules/account-deletion/server";
import {
  createAnonymousAuthRateLimiter,
  createPasskeyRecoveryRepository,
  createTurnstileValidator,
  createUserCryptoProfileRepository,
} from "@api/modules/identity/server";
import { createExpiredVaultAuditRepository, createVaultAuditRepository } from "@api/modules/audit/server";
import {
  createExpiredAccountPurgeRepository,
  createPersonalAccountRepository,
  createSharedAccountRepository,
} from "@api/modules/authenticator-account/server";
import {
  createDestructivePersonalVaultResetRepository,
  createExpiredVaultRetentionRepository,
  createPersonalVaultRepository,
  createSharedVaultRecoveryRepository,
  createSharedVaultRepository,
  createVaultKeyRotationRepository,
} from "@api/modules/vault-management/server";
import {
  createMembershipLifecycleRepository,
  createSecureShareLinkRepository,
  createSharedVaultAccessRepository,
  createSharedVaultAccountPermissionRepository,
  createVaultParticipantRepository,
} from "@api/modules/vault-membership/server";
import { createAuthorizedWorkspaceReader, createOfflineSyncBundleReader } from "@api/modules/sync/server";
import { createEncryptedVaultImportRepository } from "@api/modules/vault-archive/server";
import { createRetentionPurgeService } from "@api/modules/retention/server";

export type ApiApplicationRuntime = Readonly<{
  applicationRateLimitChecker(): ReturnType<typeof createApplicationRateLimitCheckerForDatabase>;
  accountDeletion(): AccountDeletionRepository;
  passkeyRecovery(): ReturnType<typeof createPasskeyRecoveryRepository>;
  userCryptoProfiles(): ReturnType<typeof createUserCryptoProfileRepository>;
  turnstile(): ReturnType<typeof createTurnstileValidator>;
  anonymousAuthRateLimiter(): ReturnType<typeof createAnonymousAuthRateLimiter>;
  vaultAudit(): ReturnType<typeof createVaultAuditRepository>;
  expiredVaultAudit(): ReturnType<typeof createExpiredVaultAuditRepository>;
  expiredAccountPurge(): ReturnType<typeof createExpiredAccountPurgeRepository>;
  personalAccounts(): ReturnType<typeof createPersonalAccountRepository>;
  sharedAccounts(): ReturnType<typeof createSharedAccountRepository>;
  destructivePersonalVaultReset(): ReturnType<typeof createDestructivePersonalVaultResetRepository>;
  expiredVaultRetention(): ReturnType<typeof createExpiredVaultRetentionRepository>;
  personalVaults(): ReturnType<typeof createPersonalVaultRepository>;
  sharedVaultRecovery(): ReturnType<typeof createSharedVaultRecoveryRepository>;
  sharedVaults(): ReturnType<typeof createSharedVaultRepository>;
  vaultKeyRotation(): ReturnType<typeof createVaultKeyRotationRepository>;
  membershipLifecycle(): ReturnType<typeof createMembershipLifecycleRepository>;
  secureShareLinks(): ReturnType<typeof createSecureShareLinkRepository>;
  sharedVaultAccess(): ReturnType<typeof createSharedVaultAccessRepository>;
  sharedVaultAccountPermissions(): ReturnType<typeof createSharedVaultAccountPermissionRepository>;
  vaultParticipants(): ReturnType<typeof createVaultParticipantRepository>;
  offlineSyncBundles(): ReturnType<typeof createOfflineSyncBundleReader>;
  authorizedWorkspace(): ReturnType<typeof createAuthorizedWorkspaceReader>;
  encryptedVaultImports(): ReturnType<typeof createEncryptedVaultImportRepository>;
  retentionPurge(): ReturnType<typeof createRetentionPurgeService>;
}>;

export function createApiApplicationRuntime(database: PrismaDatabase, bindings: ApiBindings): ApiApplicationRuntime {
  return {
    applicationRateLimitChecker: once(() => createApplicationRateLimitCheckerForDatabase(database)),
    accountDeletion: once(() => createAccountDeletionRepository(database, bindings)),
    passkeyRecovery: once(() => createPasskeyRecoveryRepository(database)),
    userCryptoProfiles: once(() => createUserCryptoProfileRepository(database)),
    turnstile: once(() => createTurnstileValidator(bindings)),
    anonymousAuthRateLimiter: once(() => createAnonymousAuthRateLimiter(database, bindings)),
    vaultAudit: once(() => createVaultAuditRepository(database)),
    expiredVaultAudit: once(() => createExpiredVaultAuditRepository(database)),
    expiredAccountPurge: once(() => createExpiredAccountPurgeRepository(database)),
    personalAccounts: once(() => createPersonalAccountRepository(database)),
    sharedAccounts: once(() => createSharedAccountRepository(database)),
    destructivePersonalVaultReset: once(() => createDestructivePersonalVaultResetRepository(database)),
    expiredVaultRetention: once(() => createExpiredVaultRetentionRepository(database)),
    personalVaults: once(() => createPersonalVaultRepository(database)),
    sharedVaultRecovery: once(() => createSharedVaultRecoveryRepository(database)),
    sharedVaults: once(() => createSharedVaultRepository(database)),
    vaultKeyRotation: once(() => createVaultKeyRotationRepository(database)),
    membershipLifecycle: once(() => createMembershipLifecycleRepository(database)),
    secureShareLinks: once(() => createSecureShareLinkRepository(database)),
    sharedVaultAccess: once(() => createSharedVaultAccessRepository(database)),
    sharedVaultAccountPermissions: once(() => createSharedVaultAccountPermissionRepository(database)),
    vaultParticipants: once(() => createVaultParticipantRepository(database)),
    offlineSyncBundles: once(() => createOfflineSyncBundleReader(database)),
    authorizedWorkspace: once(() => createAuthorizedWorkspaceReader(database)),
    encryptedVaultImports: once(() => createEncryptedVaultImportRepository(database)),
    retentionPurge: once(() => createRetentionPurgeService(database)),
  };
}

function once<T>(factory: () => T): () => T {
  let value: T | undefined;
  return () => {
    value ??= factory();
    return value;
  };
}
