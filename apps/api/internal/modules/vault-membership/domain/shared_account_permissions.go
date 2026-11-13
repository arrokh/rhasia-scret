package domain

type SharedVaultMemberRole string

const (
	SharedVaultMemberRoleOwner  SharedVaultMemberRole = "OWNER"
	SharedVaultMemberRoleViewer SharedVaultMemberRole = "VIEWER"
)

type SharedVaultAccountOperation string

const (
	SharedVaultAccountOperationAdd    SharedVaultAccountOperation = "ADD"
	SharedVaultAccountOperationEdit   SharedVaultAccountOperation = "EDIT"
	SharedVaultAccountOperationDelete SharedVaultAccountOperation = "DELETE"
)

type SharedVaultAccountPermissionSource string

const (
	SharedVaultAccountPermissionSourceOwner  SharedVaultAccountPermissionSource = "OWNER"
	SharedVaultAccountPermissionSourceVault  SharedVaultAccountPermissionSource = "VAULT"
	SharedVaultAccountPermissionSourceMember SharedVaultAccountPermissionSource = "MEMBER"
)

type SharedVaultAccountPermissions struct {
	CanAddAccounts    bool `json:"canAddAccounts"`
	CanEditAccounts   bool `json:"canEditAccounts"`
	CanDeleteAccounts bool `json:"canDeleteAccounts"`
}

type SharedVaultAccountPermissionOverrides struct {
	CanAddAccounts    *bool `json:"canAddAccounts"`
	CanEditAccounts   *bool `json:"canEditAccounts"`
	CanDeleteAccounts *bool `json:"canDeleteAccounts"`
}

type SharedVaultAccountPermissionSources struct {
	CanAddAccounts    SharedVaultAccountPermissionSource `json:"canAddAccounts"`
	CanEditAccounts   SharedVaultAccountPermissionSource `json:"canEditAccounts"`
	CanDeleteAccounts SharedVaultAccountPermissionSource `json:"canDeleteAccounts"`
}

type EffectiveSharedVaultAccountPermissions struct {
	Permissions SharedVaultAccountPermissions       `json:"permissions"`
	Sources     SharedVaultAccountPermissionSources `json:"sources"`
}

func ParseSharedVaultMemberRole(value string) (SharedVaultMemberRole, bool) {
	switch role := SharedVaultMemberRole(value); role {
	case SharedVaultMemberRoleOwner, SharedVaultMemberRoleViewer:
		return role, true
	default:
		return "", false
	}
}

func EffectiveSharedVaultAccountPermissionsFor(
	role SharedVaultMemberRole,
	vaultDefaults SharedVaultAccountPermissions,
	memberOverrides SharedVaultAccountPermissionOverrides,
) EffectiveSharedVaultAccountPermissions {
	if role == SharedVaultMemberRoleOwner {
		return EffectiveSharedVaultAccountPermissions{
			Permissions: SharedVaultAccountPermissions{CanAddAccounts: true, CanEditAccounts: true, CanDeleteAccounts: true},
			Sources: SharedVaultAccountPermissionSources{
				CanAddAccounts:    SharedVaultAccountPermissionSourceOwner,
				CanEditAccounts:   SharedVaultAccountPermissionSourceOwner,
				CanDeleteAccounts: SharedVaultAccountPermissionSourceOwner,
			},
		}
	}
	return EffectiveSharedVaultAccountPermissions{
		Permissions: SharedVaultAccountPermissions{
			CanAddAccounts:    permissionValue(memberOverrides.CanAddAccounts, vaultDefaults.CanAddAccounts),
			CanEditAccounts:   permissionValue(memberOverrides.CanEditAccounts, vaultDefaults.CanEditAccounts),
			CanDeleteAccounts: permissionValue(memberOverrides.CanDeleteAccounts, vaultDefaults.CanDeleteAccounts),
		},
		Sources: SharedVaultAccountPermissionSources{
			CanAddAccounts:    permissionSource(memberOverrides.CanAddAccounts),
			CanEditAccounts:   permissionSource(memberOverrides.CanEditAccounts),
			CanDeleteAccounts: permissionSource(memberOverrides.CanDeleteAccounts),
		},
	}
}

func CanPerformSharedVaultAccountOperation(
	permissions SharedVaultAccountPermissions,
	operation SharedVaultAccountOperation,
) bool {
	switch operation {
	case SharedVaultAccountOperationAdd:
		return permissions.CanAddAccounts
	case SharedVaultAccountOperationEdit:
		return permissions.CanEditAccounts
	case SharedVaultAccountOperationDelete:
		return permissions.CanDeleteAccounts
	default:
		return false
	}
}

func permissionValue(override *bool, fallback bool) bool {
	if override == nil {
		return fallback
	}
	return *override
}

func permissionSource(override *bool) SharedVaultAccountPermissionSource {
	if override == nil {
		return SharedVaultAccountPermissionSourceVault
	}
	return SharedVaultAccountPermissionSourceMember
}
