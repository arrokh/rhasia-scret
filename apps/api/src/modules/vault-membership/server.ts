import { PrismaMembershipLifecycleRepository } from "./infrastructure/prisma-membership-lifecycle-repository";
import { PrismaSecureShareLinkRepository } from "./infrastructure/prisma-secure-share-link-repository";
import { PrismaSharedVaultAccessRepository } from "./infrastructure/prisma-shared-vault-access-repository";
import { PrismaSharedVaultAccountPermissionRepository } from "./infrastructure/prisma-shared-vault-account-permission-repository";
import { PrismaVaultParticipantRepository } from "./infrastructure/prisma-vault-participant-repository";
import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";

export {
  leaveVaultMembership,
  MembershipUnavailableError,
  revokeVaultMembership,
} from "./application/manage-membership-lifecycle";
export {
  createSecureShareLinkInvitation,
  findSecureShareLinkForRecipient,
  redeemSecureShareLinkForRecipient,
} from "./application/manage-secure-share-link";
export {
  loadSharedVaultMemberPermissionDefaults,
  updateSharedVaultMemberPermissionOverrides,
  updateSharedVaultMemberPermissionDefaults,
} from "./application/manage-shared-vault-account-permissions";
export { cancelPendingVaultInvitation, listVaultParticipantsForOwner } from "./application/manage-vault-participants";
export {
  InvitationConflictError,
  InvitationRecipientUnavailableError,
  SecureShareLinkUnavailableError,
} from "./application/secure-share-link-repository";
export type { SharedVaultAccessRepository } from "./application/shared-vault-access-repository";
export { parseVaultParticipantCursorKey } from "./application/vault-participant-repository";

export function createMembershipLifecycleRepository(database: PrismaDatabase): PrismaMembershipLifecycleRepository {
  return new PrismaMembershipLifecycleRepository(database);
}

export function createSecureShareLinkRepository(database: PrismaDatabase): PrismaSecureShareLinkRepository {
  return new PrismaSecureShareLinkRepository(database);
}

export function createSharedVaultAccessRepository(database: PrismaDatabase): PrismaSharedVaultAccessRepository {
  return new PrismaSharedVaultAccessRepository(database);
}

export function createSharedVaultAccountPermissionRepository(
  database: PrismaDatabase,
): PrismaSharedVaultAccountPermissionRepository {
  return new PrismaSharedVaultAccountPermissionRepository(database);
}

export function createVaultParticipantRepository(database: PrismaDatabase): PrismaVaultParticipantRepository {
  return new PrismaVaultParticipantRepository(database);
}
