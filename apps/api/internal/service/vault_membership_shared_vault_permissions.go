package service

import (
	"context"

	apiEntity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity"
)

type SharedVaultAccountPermissionDefaults struct {
	Permissions apiEntity.SharedVaultAccountPermissions
	Revision    int64
}

type SharedVaultMemberPermissionState struct {
	Overrides apiEntity.SharedVaultAccountPermissionOverrides
	Effective apiEntity.EffectiveSharedVaultAccountPermissions
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
	UpdateVaultDefaults(context.Context, string, string, int64, apiEntity.SharedVaultAccountPermissions) (SharedVaultPermissionUpdate[SharedVaultAccountPermissionDefaults], error)
	UpdateMemberOverrides(context.Context, string, string, string, int64, apiEntity.SharedVaultAccountPermissionOverrides) (SharedVaultPermissionUpdate[SharedVaultMemberPermissionState], error)
}
