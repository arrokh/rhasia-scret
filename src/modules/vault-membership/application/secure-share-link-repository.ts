export type NewSecureShareLink = {
  recipientUserId: string;
  linkVerifier: Uint8Array;
  encryptedPackage: Uint8Array;
};

export type RedeemableSecureShareLink = {
  id: string;
  vaultId: string;
  encryptedPackage: Uint8Array;
};

export type CreatedSecureShareLink = { id: string; expiresAt: Date };

export type SecureShareLinkRecipient = { userId: string; email: string };

export class InvitationRecipientUnavailableError extends Error {}
export class InvitationConflictError extends Error {}
export class SecureShareLinkUnavailableError extends Error {}

export interface SecureShareLinkRepository {
  create(ownerId: string, vaultId: string, link: NewSecureShareLink): Promise<CreatedSecureShareLink>;
  createForEmail(ownerId: string, vaultId: string, recipientEmail: string, link: Omit<NewSecureShareLink, "recipientUserId">): Promise<CreatedSecureShareLink>;
  findForRecipient(recipient: SecureShareLinkRecipient, linkVerifier: Uint8Array): Promise<RedeemableSecureShareLink | null>;
  redeem(recipient: SecureShareLinkRecipient, invitationId: string, encryptedVaultKey: Uint8Array, keyVersion: number): Promise<void>;
}
