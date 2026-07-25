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

export interface SecureShareLinkRepository {
  create(ownerId: string, vaultId: string, link: NewSecureShareLink): Promise<{ id: string }>;
  findForRecipient(recipientUserId: string, linkVerifier: Uint8Array): Promise<RedeemableSecureShareLink | null>;
  redeem(recipientUserId: string, invitationId: string, encryptedVaultKey: Uint8Array, keyVersion: number): Promise<void>;
}
