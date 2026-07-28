import type {
  EffectiveSharedVaultAccountPermissions,
  SharedVaultAccountPermissionOverrides,
  SharedVaultAccountPermissions
} from "../domain/shared-vault-account-permissions";

export type VaultMemberPermissionDefaults = Readonly<{
  permissions: SharedVaultAccountPermissions;
  revision: number;
}>;

export type VaultMemberPermissionState = Readonly<{
  overrides: SharedVaultAccountPermissionOverrides;
  effective: EffectiveSharedVaultAccountPermissions;
  revision: number;
}>;

export type PermissionUpdateResult<T> =
  | { status: "UPDATED"; value: T }
  | { status: "STALE" }
  | { status: "UNAVAILABLE" };

export interface SharedVaultAccountPermissionRepository {
  updateVaultDefaults(
    ownerId: string,
    vaultId: string,
    expectedRevision: number,
    permissions: SharedVaultAccountPermissions
  ): Promise<PermissionUpdateResult<VaultMemberPermissionDefaults>>;

  updateMemberOverrides(
    ownerId: string,
    vaultId: string,
    memberUserId: string,
    expectedRevision: number,
    overrides: SharedVaultAccountPermissionOverrides
  ): Promise<PermissionUpdateResult<VaultMemberPermissionState>>;
}

export function updateSharedVaultMemberPermissionDefaults(
  ownerId: string,
  vaultId: string,
  expectedRevision: number,
  permissions: SharedVaultAccountPermissions,
  repository: SharedVaultAccountPermissionRepository
): Promise<PermissionUpdateResult<VaultMemberPermissionDefaults>> {
  return repository.updateVaultDefaults(ownerId, vaultId, expectedRevision, permissions);
}

export function updateSharedVaultMemberPermissionOverrides(
  ownerId: string,
  vaultId: string,
  memberUserId: string,
  expectedRevision: number,
  overrides: SharedVaultAccountPermissionOverrides,
  repository: SharedVaultAccountPermissionRepository
): Promise<PermissionUpdateResult<VaultMemberPermissionState>> {
  return repository.updateMemberOverrides(ownerId, vaultId, memberUserId, expectedRevision, overrides);
}
