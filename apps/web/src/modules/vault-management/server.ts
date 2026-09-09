import { PrismaDestructivePersonalVaultResetRepository } from "./infrastructure/prisma-destructive-personal-vault-reset-repository";
import { PrismaExpiredVaultRetentionRepository } from "./infrastructure/prisma-expired-vault-retention-repository";
import { PrismaPersonalVaultRepository } from "./infrastructure/prisma-personal-vault-repository";
import { PrismaSharedVaultRecoveryRepository } from "./infrastructure/prisma-shared-vault-recovery-repository";
import { PrismaSharedVaultRepository } from "./infrastructure/prisma-shared-vault-repository";
import { PrismaVaultKeyRotationRepository } from "./infrastructure/prisma-vault-key-rotation-repository";

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

export function createDestructivePersonalVaultResetRepository(): PrismaDestructivePersonalVaultResetRepository {
  return new PrismaDestructivePersonalVaultResetRepository();
}

export function createExpiredVaultRetentionRepository(): PrismaExpiredVaultRetentionRepository {
  return new PrismaExpiredVaultRetentionRepository();
}

export function createPersonalVaultRepository(): PrismaPersonalVaultRepository {
  return new PrismaPersonalVaultRepository();
}

export function createSharedVaultRecoveryRepository(): PrismaSharedVaultRecoveryRepository {
  return new PrismaSharedVaultRecoveryRepository();
}

export function createSharedVaultRepository(): PrismaSharedVaultRepository {
  return new PrismaSharedVaultRepository();
}

export function createVaultKeyRotationRepository(): PrismaVaultKeyRotationRepository {
  return new PrismaVaultKeyRotationRepository();
}
