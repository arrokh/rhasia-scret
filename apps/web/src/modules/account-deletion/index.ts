export {
  ACCOUNT_DELETION_CONFIRMATION,
  ACCOUNT_DELETION_OTP_DIGITS,
  ACCOUNT_DELETION_OTP_MAX_ATTEMPTS,
  ACCOUNT_DELETION_OTP_TTL_SECONDS,
  isAccountDeletionConfirmation,
  isValidOtp,
  validateAccountDeletionRequest,
} from "./domain/account-deletion-policy";
export type {
  AccountDeletionAuthBackend,
  AccountDeletionRequest,
  OwnedSharedVaultAction,
  OwnedSharedVaultDecision,
} from "./domain/account-deletion-policy";
export {
  AccountDeletionAuthorizationError,
  AccountDeletionChallengeUnavailableError,
  AccountDeletionOtpInvalidError,
  AccountDeletionOtpLockedError,
  AccountDeletionPlanStaleError,
} from "./domain/account-deletion-errors";
export type {
  AccountDeletionEmailSender,
  AccountDeletionCompletionEmail,
  AccountDeletionOtpEmail,
} from "./application/account-deletion-email";
export type {
  AccountDeletionChallenge,
  AccountDeletionChallengePurpose,
  AccountDeletionPreview,
  AccountDeletionRepository,
  AccountDeletionResult,
} from "./application/account-deletion-repository";
export { AccountDeletionPage } from "./presentation/account-deletion-page";
export { AccountDeletionCompletePage } from "./presentation/account-deletion-complete-page";
export {
  clearDeletedBrowserState,
  deleteAccount,
  loadAccountDeletionPreview,
  requestAccountDeletionOtp,
  startAccountDeletionOidcReauthentication,
  verifyAccountDeletionOtp,
} from "./infrastructure/browser-account-deletion-client";
