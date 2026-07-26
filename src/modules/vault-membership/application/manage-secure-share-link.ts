import type { NewSecureShareLink, SecureShareLinkRecipient, SecureShareLinkRepository } from "./secure-share-link-repository";

export function createSecureShareLinkInvitation(
  ownerId: string,
  vaultId: string,
  recipientEmail: string,
  link: Omit<NewSecureShareLink, "recipientUserId">,
  repository: SecureShareLinkRepository
) {
  return repository.createForEmail(ownerId, vaultId, recipientEmail, link);
}

export function findSecureShareLinkForRecipient(recipient: SecureShareLinkRecipient, verifier: Uint8Array, repository: SecureShareLinkRepository) {
  return repository.findForRecipient(recipient, verifier);
}

export function redeemSecureShareLinkForRecipient(
  recipient: SecureShareLinkRecipient,
  invitationId: string,
  encryptedVaultKey: Uint8Array,
  keyVersion: number,
  repository: SecureShareLinkRepository
) {
  return repository.redeem(recipient, invitationId, encryptedVaultKey, keyVersion);
}
