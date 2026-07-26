export const DESTRUCTIVE_RESET_CONFIRMATION = "HAPUS DATA BRANKAS";

export type DestructivePersonalVaultResetEligibility = {
  passkeyRecoveryEnrolled: boolean;
  activeOwnedSharedVaults: number;
  activeOwnedSharedVaultIds: string[];
};

export interface DestructivePersonalVaultResetRepository {
  getEligibility(userId: string): Promise<DestructivePersonalVaultResetEligibility>;
  reset(userId: string): Promise<void>;
}

export class InvalidDestructiveResetConfirmationError extends Error {}
export class PasskeyRecoveryAlreadyEnrolledError extends Error {}
export class ActiveOwnedSharedVaultsPreventResetError extends Error {
  public constructor(public readonly count: number) {
    super("Active owned Shared Vaults prevent destructive reset.");
  }
}

export async function destructivelyResetPersonalVault(
  userId: string,
  confirmation: string,
  repository: DestructivePersonalVaultResetRepository
): Promise<void> {
  if (!userId) throw new Error("An application user is required for destructive reset.");
  if (confirmation !== DESTRUCTIVE_RESET_CONFIRMATION) {
    throw new InvalidDestructiveResetConfirmationError("Destructive reset confirmation does not match.");
  }
  await repository.reset(userId);
}
