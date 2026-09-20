export type AccountDeletionOtpEmail = Readonly<{
  recipientEmail: string;
  otp: string;
}>;

export type AccountDeletionCompletionEmail = Readonly<{
  recipientEmail: string;
  receiptId: string;
}>;

export interface AccountDeletionEmailSender {
  sendDeletionOtpEmail(email: AccountDeletionOtpEmail): Promise<void>;
  sendDeletionCompletionEmail(email: AccountDeletionCompletionEmail): Promise<void>;
}
