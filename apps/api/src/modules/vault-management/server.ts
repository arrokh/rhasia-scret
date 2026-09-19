import { PrismaDestructivePersonalVaultResetRepository } from "./infrastructure/prisma-destructive-personal-vault-reset-repository";
import { PrismaExpiredVaultRetentionRepository } from "./infrastructure/prisma-expired-vault-retention-repository";
import { PrismaPersonalVaultRepository } from "./infrastructure/prisma-personal-vault-repository";
import { PrismaSharedVaultRecoveryRepository } from "./infrastructure/prisma-shared-vault-recovery-repository";
import { PrismaSharedVaultRepository } from "./infrastructure/prisma-shared-vault-repository";
import { PrismaVaultKeyRotationRepository } from "./infrastructure/prisma-vault-key-rotation-repository";
import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";

export {
  ActiveOwnedSharedVaultsPreventResetError,
  InvalidDestructiveResetConfirmationError,
  PasskeyRecoveryAlreadyEnrolledError,
  destructivelyResetPersonalVault,
} from "./application/destructive-personal-vault-reset";
export type { DestructivePersonalVaultResetRepository } from "./application/destructive-personal-vault-reset";
export { ensurePersonalVault } from "./application/ensure-personal-vault";
export { initializePersonalVault } from "./application/initialize-personal-vault";
export type { PersonalVaultInitializer } from "./application/initialize-personal-vault";
export type { PersonalVaultRepository } from "./application/personal-vault-repository";
export {
  purgeExpiredSharedVaults,
  type ExpiredVaultRetentionRepository,
  type VaultPurgeBatch,
} from "./application/purge-expired-vault-retention";
export type { SharedVaultRepository } from "./application/shared-vault-repository";

export function createDestructivePersonalVaultResetRepository(
  database: PrismaDatabase,
): PrismaDestructivePersonalVaultResetRepository {
  return new PrismaDestructivePersonalVaultResetRepository(database);
}

export function createExpiredVaultRetentionRepository(database: PrismaDatabase): PrismaExpiredVaultRetentionRepository {
  return new PrismaExpiredVaultRetentionRepository(database);
}

export function createPersonalVaultRepository(database: PrismaDatabase): PrismaPersonalVaultRepository {
  return new PrismaPersonalVaultRepository(database);
}

export function createSharedVaultRecoveryRepository(database: PrismaDatabase): PrismaSharedVaultRecoveryRepository {
  return new PrismaSharedVaultRecoveryRepository(database);
}

export function createSharedVaultRepository(database: PrismaDatabase): PrismaSharedVaultRepository {
  return new PrismaSharedVaultRepository(database);
}

export function createVaultKeyRotationRepository(database: PrismaDatabase): PrismaVaultKeyRotationRepository {
  return new PrismaVaultKeyRotationRepository(database);
}
