export const ACCOUNT_DELETION_CONFIRMATION = "HAPUS AKUN";
export const ACCOUNT_DELETION_OTP_DIGITS = 6;
export const ACCOUNT_DELETION_OTP_TTL_SECONDS = 600;
export const ACCOUNT_DELETION_OTP_MAX_ATTEMPTS = 5;
export const ACCOUNT_DELETION_AUTHORIZATION_TTL_SECONDS = 600;

export type AccountDeletionAuthBackend = "passwordless" | "oidc";
export type OwnedSharedVaultAction = "DELETE" | "TRANSFER";

export type OwnedSharedVaultDecision = Readonly<{
  vaultId: string;
  action: OwnedSharedVaultAction;
  transferToUserId?: string;
}>;

export type AccountDeletionRequest = Readonly<{
  confirmation: string;
  acknowledged: boolean;
  vaultDecisions: readonly OwnedSharedVaultDecision[];
}>;

export function isAccountDeletionConfirmation(value: unknown): value is typeof ACCOUNT_DELETION_CONFIRMATION {
  return value === ACCOUNT_DELETION_CONFIRMATION;
}

export function isValidOtp(value: unknown): value is string {
  return typeof value === "string" && new RegExp(`^\\d{${ACCOUNT_DELETION_OTP_DIGITS}}$`).test(value);
}

export function validateAccountDeletionRequest(input: AccountDeletionRequest): void {
  if (!isAccountDeletionConfirmation(input.confirmation)) throw new Error("invalid_confirmation");
  if (input.acknowledged !== true) throw new Error("acknowledgement_required");
  const ids = new Set<string>();
  for (const decision of input.vaultDecisions) {
    if (!isOpaqueIdentifier(decision.vaultId) || ids.has(decision.vaultId)) throw new Error("invalid_vault_decisions");
    ids.add(decision.vaultId);
    if (decision.action === "TRANSFER") {
      if (!isOpaqueIdentifier(decision.transferToUserId)) throw new Error("invalid_transfer_target");
    } else if (decision.action !== "DELETE" || decision.transferToUserId !== undefined) {
      throw new Error("invalid_vault_decisions");
    }
  }
}

export function isOpaqueIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(value);
}
