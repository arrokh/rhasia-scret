export class MembershipUnavailableError extends Error {}

export interface MembershipLifecycleRepository {
  revoke(ownerId: string, vaultId: string, memberUserId: string): Promise<void>;
  leave(viewerId: string, vaultId: string): Promise<void>;
}

export function revokeVaultMembership(ownerId: string, vaultId: string, memberUserId: string, repository: MembershipLifecycleRepository) {
  return repository.revoke(ownerId, vaultId, memberUserId);
}

export function leaveVaultMembership(viewerId: string, vaultId: string, repository: MembershipLifecycleRepository) {
  return repository.leave(viewerId, vaultId);
}
