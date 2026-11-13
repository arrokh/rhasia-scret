package application

import (
	"context"

	membershipdomain "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-membership/domain"
)

type SharedVaultAccountPermissionDefaults struct {
	Permissions membershipdomain.SharedVaultAccountPermissions
	Revision    int64
}

type SharedVaultMemberPermissionState struct {
	Overrides membershipdomain.SharedVaultAccountPermissionOverrides
	Effective membershipdomain.EffectiveSharedVaultAccountPermissions
	Revision  int64
}

type SharedVaultPermissionUpdateStatus string

const (
	SharedVaultPermissionUpdateUpdated     SharedVaultPermissionUpdateStatus = "UPDATED"
	SharedVaultPermissionUpdateStale       SharedVaultPermissionUpdateStatus = "STALE"
	SharedVaultPermissionUpdateUnavailable SharedVaultPermissionUpdateStatus = "UNAVAILABLE"
)

type SharedVaultPermissionUpdate[T any] struct {
	Status SharedVaultPermissionUpdateStatus
	Value  T
}

type SharedVaultAccountPermissionRepository interface {
	ReadVaultDefaults(context.Context, string, string) (*SharedVaultAccountPermissionDefaults, error)
	UpdateVaultDefaults(context.Context, string, string, int64, membershipdomain.SharedVaultAccountPermissions) (SharedVaultPermissionUpdate[SharedVaultAccountPermissionDefaults], error)
	UpdateMemberOverrides(context.Context, string, string, string, int64, membershipdomain.SharedVaultAccountPermissionOverrides) (SharedVaultPermissionUpdate[SharedVaultMemberPermissionState], error)
}
