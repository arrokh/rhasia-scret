export type SharedVaultAccountPermission = "ADD" | "EDIT" | "DELETE";

export type SharedVaultAccountPermissions = Readonly<{
  canAddAccounts: boolean;
  canEditAccounts: boolean;
  canDeleteAccounts: boolean;
}>;

export type SharedVaultAccountPermissionOverrides = Readonly<{
  canAddAccounts: boolean | null;
  canEditAccounts: boolean | null;
  canDeleteAccounts: boolean | null;
}>;

export type SharedVaultAccountPermissionSources = Readonly<{
  canAddAccounts: "OWNER" | "VAULT" | "MEMBER";
  canEditAccounts: "OWNER" | "VAULT" | "MEMBER";
  canDeleteAccounts: "OWNER" | "VAULT" | "MEMBER";
}>;

export type EffectiveSharedVaultAccountPermissions = Readonly<{
  permissions: SharedVaultAccountPermissions;
  sources: SharedVaultAccountPermissionSources;
}>;

export const NO_ACCOUNT_PERMISSIONS: SharedVaultAccountPermissions = Object.freeze({
  canAddAccounts: false,
  canEditAccounts: false,
  canDeleteAccounts: false
});

export const ALL_ACCOUNT_PERMISSIONS: SharedVaultAccountPermissions = Object.freeze({
  canAddAccounts: true,
  canEditAccounts: true,
  canDeleteAccounts: true
});

export const NO_ACCOUNT_PERMISSION_OVERRIDES: SharedVaultAccountPermissionOverrides = Object.freeze({
  canAddAccounts: null,
  canEditAccounts: null,
  canDeleteAccounts: null
});

export function effectiveSharedVaultAccountPermissions(
  role: "OWNER" | "VIEWER",
  vaultDefaults: SharedVaultAccountPermissions,
  memberOverrides: SharedVaultAccountPermissionOverrides
): EffectiveSharedVaultAccountPermissions {
  if (role === "OWNER") {
    return {
      permissions: ALL_ACCOUNT_PERMISSIONS,
      sources: {
        canAddAccounts: "OWNER",
        canEditAccounts: "OWNER",
        canDeleteAccounts: "OWNER"
      }
    };
  }

  return {
    permissions: {
      canAddAccounts: memberOverrides.canAddAccounts ?? vaultDefaults.canAddAccounts,
      canEditAccounts: memberOverrides.canEditAccounts ?? vaultDefaults.canEditAccounts,
      canDeleteAccounts: memberOverrides.canDeleteAccounts ?? vaultDefaults.canDeleteAccounts
    },
    sources: {
      canAddAccounts: memberOverrides.canAddAccounts === null ? "VAULT" : "MEMBER",
      canEditAccounts: memberOverrides.canEditAccounts === null ? "VAULT" : "MEMBER",
      canDeleteAccounts: memberOverrides.canDeleteAccounts === null ? "VAULT" : "MEMBER"
    }
  };
}

export function canPerformSharedVaultAccountOperation(
  permissions: SharedVaultAccountPermissions,
  operation: SharedVaultAccountPermission
): boolean {
  if (operation === "ADD") return permissions.canAddAccounts;
  if (operation === "EDIT") return permissions.canEditAccounts;
  return permissions.canDeleteAccounts;
}
