package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	apiEntity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity"
	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
)

type SharedVaultAccountPermissionRepository struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewSharedVaultAccountPermissionRepository(pool *pgxpool.Pool, now func() time.Time) (*SharedVaultAccountPermissionRepository, error) {
	if pool == nil {
		return nil, errors.New("Shared Vault permission repository is not configured")
	}
	if now == nil {
		now = time.Now
	}
	return &SharedVaultAccountPermissionRepository{pool: pool, now: now}, nil
}

func (repository *SharedVaultAccountPermissionRepository) ReadVaultDefaults(
	ctx context.Context,
	ownerID string,
	vaultID string,
) (*apiService.SharedVaultAccountPermissionDefaults, error) {
	var permissions apiEntity.SharedVaultAccountPermissions
	var revision int32
	err := repository.pool.QueryRow(ctx, `
		SELECT members_can_add_accounts, members_can_edit_accounts, members_can_delete_accounts,
		       member_permissions_revision
		FROM vaults
		WHERE id = $1 AND owner_id = $2 AND type = 'SHARED' AND lifecycle = 'ACTIVE' AND deleted_at IS NULL`,
		vaultID, ownerID).Scan(
		&permissions.CanAddAccounts, &permissions.CanEditAccounts, &permissions.CanDeleteAccounts, &revision,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read Shared Vault account permission defaults: %w", err)
	}
	return &apiService.SharedVaultAccountPermissionDefaults{Permissions: permissions, Revision: int64(revision)}, nil
}

func (repository *SharedVaultAccountPermissionRepository) UpdateVaultDefaults(
	ctx context.Context,
	ownerID string,
	vaultID string,
	expectedRevision int64,
	permissions apiEntity.SharedVaultAccountPermissions,
) (apiService.SharedVaultPermissionUpdate[apiService.SharedVaultAccountPermissionDefaults], error) {
	transaction, err := repository.pool.Begin(ctx)
	if err != nil {
		return apiService.SharedVaultPermissionUpdate[apiService.SharedVaultAccountPermissionDefaults]{}, fmt.Errorf("begin Shared Vault default permission update: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	available, err := lockOwnedActiveSharedVault(ctx, transaction, ownerID, vaultID)
	if err != nil {
		return apiService.SharedVaultPermissionUpdate[apiService.SharedVaultAccountPermissionDefaults]{}, fmt.Errorf("lock Shared Vault for default permission update: %w", err)
	}
	if !available {
		return apiService.SharedVaultPermissionUpdate[apiService.SharedVaultAccountPermissionDefaults]{Status: apiService.SharedVaultPermissionUpdateUnavailable}, nil
	}
	command, err := transaction.Exec(ctx, `
		UPDATE vaults
		SET members_can_add_accounts = $3,
		    members_can_edit_accounts = $4,
		    members_can_delete_accounts = $5,
		    member_permissions_revision = member_permissions_revision + 1,
		    updated_at = $6
		WHERE id = $1 AND owner_id = $2 AND type = 'SHARED' AND lifecycle = 'ACTIVE'
		  AND deleted_at IS NULL AND member_permissions_revision = $7`,
		vaultID, ownerID, permissions.CanAddAccounts, permissions.CanEditAccounts, permissions.CanDeleteAccounts,
		repository.now(), expectedRevision)
	if err != nil {
		return apiService.SharedVaultPermissionUpdate[apiService.SharedVaultAccountPermissionDefaults]{}, fmt.Errorf("update Shared Vault account permission defaults: %w", err)
	}
	if command.RowsAffected() != 1 {
		return apiService.SharedVaultPermissionUpdate[apiService.SharedVaultAccountPermissionDefaults]{Status: apiService.SharedVaultPermissionUpdateStale}, nil
	}
	var stored apiEntity.SharedVaultAccountPermissions
	var revision int32
	if err := transaction.QueryRow(ctx, `
		SELECT members_can_add_accounts, members_can_edit_accounts, members_can_delete_accounts, member_permissions_revision
		FROM vaults WHERE id = $1`, vaultID).Scan(
		&stored.CanAddAccounts, &stored.CanEditAccounts, &stored.CanDeleteAccounts, &revision,
	); err != nil {
		return apiService.SharedVaultPermissionUpdate[apiService.SharedVaultAccountPermissionDefaults]{}, fmt.Errorf("read updated Shared Vault account permission defaults: %w", err)
	}
	if err := AppendVaultAuditEvent(ctx, transaction, apiEntity.VaultAuditAppend{
		VaultID: vaultID, OwnerID: ownerID, ActorUserID: ownerID, Action: apiEntity.ActionVaultMemberDefaultPermissionsUpdated,
	}); err != nil {
		return apiService.SharedVaultPermissionUpdate[apiService.SharedVaultAccountPermissionDefaults]{}, err
	}
	if err := transaction.Commit(ctx); err != nil {
		return apiService.SharedVaultPermissionUpdate[apiService.SharedVaultAccountPermissionDefaults]{}, fmt.Errorf("commit Shared Vault default permission update: %w", err)
	}
	return apiService.SharedVaultPermissionUpdate[apiService.SharedVaultAccountPermissionDefaults]{
		Status: apiService.SharedVaultPermissionUpdateUpdated,
		Value:  apiService.SharedVaultAccountPermissionDefaults{Permissions: stored, Revision: int64(revision)},
	}, nil
}

func (repository *SharedVaultAccountPermissionRepository) UpdateMemberOverrides(
	ctx context.Context,
	ownerID string,
	vaultID string,
	memberUserID string,
	expectedRevision int64,
	overrides apiEntity.SharedVaultAccountPermissionOverrides,
) (apiService.SharedVaultPermissionUpdate[apiService.SharedVaultMemberPermissionState], error) {
	transaction, err := repository.pool.Begin(ctx)
	if err != nil {
		return apiService.SharedVaultPermissionUpdate[apiService.SharedVaultMemberPermissionState]{}, fmt.Errorf("begin Shared Vault member permission update: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	available, err := lockOwnedActiveSharedVault(ctx, transaction, ownerID, vaultID)
	if err != nil {
		return apiService.SharedVaultPermissionUpdate[apiService.SharedVaultMemberPermissionState]{}, fmt.Errorf("lock Shared Vault for member permission update: %w", err)
	}
	if !available {
		return apiService.SharedVaultPermissionUpdate[apiService.SharedVaultMemberPermissionState]{Status: apiService.SharedVaultPermissionUpdateUnavailable}, nil
	}
	command, err := transaction.Exec(ctx, `
		UPDATE vault_members
		SET can_add_accounts_override = $4,
		    can_edit_accounts_override = $5,
		    can_delete_accounts_override = $6,
		    permissions_revision = permissions_revision + 1,
		    updated_at = $7
		WHERE vault_id = $1 AND user_id = $2 AND role = 'VIEWER' AND status = 'ACTIVE'
		  AND permissions_revision = $3`,
		vaultID, memberUserID, expectedRevision, overrides.CanAddAccounts, overrides.CanEditAccounts,
		overrides.CanDeleteAccounts, repository.now())
	if err != nil {
		return apiService.SharedVaultPermissionUpdate[apiService.SharedVaultMemberPermissionState]{}, fmt.Errorf("update Shared Vault member account permission overrides: %w", err)
	}
	if command.RowsAffected() != 1 {
		var available bool
		if err := transaction.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM vault_members
				WHERE vault_id = $1 AND user_id = $2 AND role = 'VIEWER' AND status = 'ACTIVE'
			)`, vaultID, memberUserID).Scan(&available); err != nil {
			return apiService.SharedVaultPermissionUpdate[apiService.SharedVaultMemberPermissionState]{}, fmt.Errorf("check active Shared Vault member permission state: %w", err)
		}
		if available {
			return apiService.SharedVaultPermissionUpdate[apiService.SharedVaultMemberPermissionState]{Status: apiService.SharedVaultPermissionUpdateStale}, nil
		}
		return apiService.SharedVaultPermissionUpdate[apiService.SharedVaultMemberPermissionState]{Status: apiService.SharedVaultPermissionUpdateUnavailable}, nil
	}
	var storedOverrides apiEntity.SharedVaultAccountPermissionOverrides
	var defaults apiEntity.SharedVaultAccountPermissions
	var role string
	var revision int32
	var canAdd, canEdit, canDelete pgtype.Bool
	if err := transaction.QueryRow(ctx, `
		SELECT member.role,
		       member.can_add_accounts_override, member.can_edit_accounts_override, member.can_delete_accounts_override,
		       member.permissions_revision,
		       vault.members_can_add_accounts, vault.members_can_edit_accounts, vault.members_can_delete_accounts
		FROM vault_members AS member
		JOIN vaults AS vault ON vault.id = member.vault_id
		WHERE member.vault_id = $1 AND member.user_id = $2`, vaultID, memberUserID).Scan(
		&role, &canAdd, &canEdit, &canDelete, &revision,
		&defaults.CanAddAccounts, &defaults.CanEditAccounts, &defaults.CanDeleteAccounts,
	); err != nil {
		return apiService.SharedVaultPermissionUpdate[apiService.SharedVaultMemberPermissionState]{}, fmt.Errorf("read updated Shared Vault member permissions: %w", err)
	}
	storedOverrides = apiEntity.SharedVaultAccountPermissionOverrides{
		CanAddAccounts: nullableBool(canAdd), CanEditAccounts: nullableBool(canEdit), CanDeleteAccounts: nullableBool(canDelete),
	}
	parsedRole, validRole := apiEntity.ParseSharedVaultMemberRole(role)
	if !validRole {
		return apiService.SharedVaultPermissionUpdate[apiService.SharedVaultMemberPermissionState]{}, errors.New("updated Shared Vault member has an invalid role")
	}
	if err := AppendVaultAuditEvent(ctx, transaction, apiEntity.VaultAuditAppend{
		VaultID: vaultID, OwnerID: ownerID, ActorUserID: ownerID,
		Action: apiEntity.ActionMemberPermissionsUpdated, TargetID: memberUserID,
	}); err != nil {
		return apiService.SharedVaultPermissionUpdate[apiService.SharedVaultMemberPermissionState]{}, err
	}
	if err := transaction.Commit(ctx); err != nil {
		return apiService.SharedVaultPermissionUpdate[apiService.SharedVaultMemberPermissionState]{}, fmt.Errorf("commit Shared Vault member permission update: %w", err)
	}
	return apiService.SharedVaultPermissionUpdate[apiService.SharedVaultMemberPermissionState]{
		Status: apiService.SharedVaultPermissionUpdateUpdated,
		Value: apiService.SharedVaultMemberPermissionState{
			Overrides: storedOverrides,
			Effective: apiEntity.EffectiveSharedVaultAccountPermissionsFor(parsedRole, defaults, storedOverrides),
			Revision:  int64(revision),
		},
	}, nil
}

func lockOwnedActiveSharedVault(ctx context.Context, transaction pgx.Tx, ownerID string, vaultID string) (bool, error) {
	var lockedID string
	err := transaction.QueryRow(ctx, `
		SELECT id FROM vaults
		WHERE id = $1 AND owner_id = $2 AND type = 'SHARED' AND lifecycle = 'ACTIVE' AND deleted_at IS NULL
		FOR UPDATE`, vaultID, ownerID).Scan(&lockedID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

var _ apiService.SharedVaultAccountPermissionRepository = (*SharedVaultAccountPermissionRepository)(nil)
