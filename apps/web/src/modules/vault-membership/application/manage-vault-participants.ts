import type { CursorPageRequest } from "@/shared/application/cursor-page";
import type { VaultParticipantRepository } from "./vault-participant-repository";

export function listVaultParticipantsForOwner(ownerId: string, vaultId: string, request: CursorPageRequest, repository: VaultParticipantRepository) {
  return repository.listForOwner(ownerId, vaultId, request);
}

export function cancelPendingVaultInvitation(ownerId: string, vaultId: string, invitationId: string, repository: VaultParticipantRepository) {
  return repository.cancelInvitation(ownerId, vaultId, invitationId);
}
