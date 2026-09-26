import type { AccountDeletionAuthBackend, AccountDeletionRequest } from "../domain/account-deletion-policy";

export type AccountDeletionVaultPreview = Readonly<{
  id: string;
  lifecycle: string;
  viewerCandidates: readonly Readonly<{ id: string; email: string }>[];
}>;

export type AccountDeletionPreview = Readonly<{
  personalVaultId: string | null;
  ownedSharedVaults: readonly AccountDeletionVaultPreview[];
}>;

export type AccountDeletionChallengePurpose = "PASSWORDLESS_OTP";

export type AccountDeletionChallenge = Readonly<{
  id: string;
  applicationUserId: string;
  purpose: AccountDeletionChallengePurpose;
  expiresAt: Date;
}>;

export type AccountDeletionResult = Readonly<{
  receiptId: string;
  email: string;
  authBackend: AccountDeletionAuthBackend;
  personalVaultCount: number;
  sharedVaultDeletedCount: number;
  sharedVaultTransferredCount: number;
  authenticatorAccountCount: number;
}>;

export type CompletedAccountDeletion = Readonly<{
  receiptId: string;
  emailDeliveryStatus: string;
}>;

export interface AccountDeletionRepository {
  getPreview(applicationUserId: string): Promise<AccountDeletionPreview>;
  createPasswordlessOtpChallenge(
    applicationUserId: string,
    now: Date,
  ): Promise<Readonly<{ challengeId: string; otp: string }>>;
  verifyPasswordlessOtp(
    applicationUserId: string,
    otp: string,
    now: Date,
  ): Promise<Readonly<{ authorizationToken: string }>>;
  findCompletedDeletion(authorizationToken: string): Promise<CompletedAccountDeletion | null>;
  deleteUser(
    applicationUserId: string,
    authorizationToken: string,
    authBackend: AccountDeletionAuthBackend,
    request: AccountDeletionRequest,
    now: Date,
  ): Promise<AccountDeletionResult>;
  recordCompletionEmailStatus(receiptId: string, status: "SENT" | "FAILED"): Promise<void>;
}
