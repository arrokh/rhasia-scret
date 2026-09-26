export const MAX_INVITATION_RECIPIENT_EMAIL_LENGTH = 254;

export type NewSecureShareLink = {
  recipientUserId: string;
  linkVerifier: Uint8Array;
  encryptedPackage: Uint8Array;
  expectedKeyVersion: number;
};

export type RedeemableSecureShareLink = {
  id: string;
  vaultId: string;
  encryptedPackage: Uint8Array;
  keyVersion: number;
};

export type CreatedSecureShareLink = { id: string; expiresAt: Date };

export type SecureShareLinkRecipient = { userId: string; email: string };

export class InvitationRecipientUnavailableError extends Error {}
export class InvitationConflictError extends Error {}
export class SecureShareLinkUnavailableError extends Error {}
export class StaleRecipientEncryptionIdentityError extends Error {}

export interface SecureShareLinkRepository {
  create(ownerId: string, vaultId: string, link: NewSecureShareLink): Promise<CreatedSecureShareLink>;
  createForEmail(
    ownerId: string,
    vaultId: string,
    recipientEmail: string,
    link: Omit<NewSecureShareLink, "recipientUserId">,
  ): Promise<CreatedSecureShareLink>;
  findForRecipient(
    recipient: SecureShareLinkRecipient,
    linkVerifier: Uint8Array,
  ): Promise<RedeemableSecureShareLink | null>;
  redeem(
    recipient: SecureShareLinkRecipient,
    invitationId: string,
    encryptedVaultKey: Uint8Array,
    keyVersion: number,
    expectedPublicKey: JsonWebKey,
  ): Promise<void>;
}
