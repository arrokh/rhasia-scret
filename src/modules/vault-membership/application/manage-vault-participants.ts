import type { VaultParticipantRepository } from "./vault-participant-repository";

export function listVaultParticipantsForOwner(ownerId: string, vaultId: string, repository: VaultParticipantRepository) {
  return repository.listForOwner(ownerId, vaultId);
}

export function cancelPendingVaultInvitation(ownerId: string, vaultId: string, invitationId: string, repository: VaultParticipantRepository) {
  return repository.cancelInvitation(ownerId, vaultId, invitationId);
}
