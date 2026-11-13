package infrastructure

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/audit"
	membershipapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-membership/application"
	membershipdomain "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-membership/domain"
)

type PostgresSharedVaultAccountPermissionRepository struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewPostgresSharedVaultAccountPermissionRepository(pool *pgxpool.Pool, now func() time.Time) (*PostgresSharedVaultAccountPermissionRepository, error) {
	if pool == nil {
		return nil, errors.New("Shared Vault permission repository is not configured")
	}
	if now == nil {
		now = time.Now
	}
	return &PostgresSharedVaultAccountPermissionRepository{pool: pool, now: now}, nil
}

func (repository *PostgresSharedVaultAccountPermissionRepository) ReadVaultDefaults(
	ctx context.Context,
	ownerID string,
	vaultID string,
) (*membershipapp.SharedVaultAccountPermissionDefaults, error) {
	var permissions membershipdomain.SharedVaultAccountPermissions
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
	return &membershipapp.SharedVaultAccountPermissionDefaults{Permissions: permissions, Revision: int64(revision)}, nil
}

func (repository *PostgresSharedVaultAccountPermissionRepository) UpdateVaultDefaults(
	ctx context.Context,
	ownerID string,
	vaultID string,
	expectedRevision int64,
	permissions membershipdomain.SharedVaultAccountPermissions,
) (membershipapp.SharedVaultPermissionUpdate[membershipapp.SharedVaultAccountPermissionDefaults], error) {
	transaction, err := repository.pool.Begin(ctx)
	if err != nil {
		return membershipapp.SharedVaultPermissionUpdate[membershipapp.SharedVaultAccountPermissionDefaults]{}, fmt.Errorf("begin Shared Vault default permission update: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	available, err := lockOwnedActiveSharedVault(ctx, transaction, ownerID, vaultID)
	if err != nil {
		return membershipapp.SharedVaultPermissionUpdate[membershipapp.SharedVaultAccountPermissionDefaults]{}, fmt.Errorf("lock Shared Vault for default permission update: %w", err)
	}
	if !available {
		return membershipapp.SharedVaultPermissionUpdate[membershipapp.SharedVaultAccountPermissionDefaults]{Status: membershipapp.SharedVaultPermissionUpdateUnavailable}, nil
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
		return membershipapp.SharedVaultPermissionUpdate[membershipapp.SharedVaultAccountPermissionDefaults]{}, fmt.Errorf("update Shared Vault account permission defaults: %w", err)
	}
	if command.RowsAffected() != 1 {
		return membershipapp.SharedVaultPermissionUpdate[membershipapp.SharedVaultAccountPermissionDefaults]{Status: membershipapp.SharedVaultPermissionUpdateStale}, nil
	}
	var stored membershipdomain.SharedVaultAccountPermissions
	var revision int32
	if err := transaction.QueryRow(ctx, `
		SELECT members_can_add_accounts, members_can_edit_accounts, members_can_delete_accounts, member_permissions_revision
		FROM vaults WHERE id = $1`, vaultID).Scan(
		&stored.CanAddAccounts, &stored.CanEditAccounts, &stored.CanDeleteAccounts, &revision,
	); err != nil {
		return membershipapp.SharedVaultPermissionUpdate[membershipapp.SharedVaultAccountPermissionDefaults]{}, fmt.Errorf("read updated Shared Vault account permission defaults: %w", err)
	}
	if err := audit.AppendVaultAuditEvent(ctx, transaction, audit.VaultAuditAppend{
		VaultID: vaultID, OwnerID: ownerID, ActorUserID: ownerID, Action: audit.ActionVaultMemberDefaultPermissionsUpdated,
	}); err != nil {
		return membershipapp.SharedVaultPermissionUpdate[membershipapp.SharedVaultAccountPermissionDefaults]{}, err
	}
	if err := transaction.Commit(ctx); err != nil {
		return membershipapp.SharedVaultPermissionUpdate[membershipapp.SharedVaultAccountPermissionDefaults]{}, fmt.Errorf("commit Shared Vault default permission update: %w", err)
	}
	return membershipapp.SharedVaultPermissionUpdate[membershipapp.SharedVaultAccountPermissionDefaults]{
		Status: membershipapp.SharedVaultPermissionUpdateUpdated,
		Value:  membershipapp.SharedVaultAccountPermissionDefaults{Permissions: stored, Revision: int64(revision)},
	}, nil
}

func (repository *PostgresSharedVaultAccountPermissionRepository) UpdateMemberOverrides(
	ctx context.Context,
	ownerID string,
	vaultID string,
	memberUserID string,
	expectedRevision int64,
	overrides membershipdomain.SharedVaultAccountPermissionOverrides,
) (membershipapp.SharedVaultPermissionUpdate[membershipapp.SharedVaultMemberPermissionState], error) {
	transaction, err := repository.pool.Begin(ctx)
	if err != nil {
		return membershipapp.SharedVaultPermissionUpdate[membershipapp.SharedVaultMemberPermissionState]{}, fmt.Errorf("begin Shared Vault member permission update: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	available, err := lockOwnedActiveSharedVault(ctx, transaction, ownerID, vaultID)
	if err != nil {
		return membershipapp.SharedVaultPermissionUpdate[membershipapp.SharedVaultMemberPermissionState]{}, fmt.Errorf("lock Shared Vault for member permission update: %w", err)
	}
	if !available {
		return membershipapp.SharedVaultPermissionUpdate[membershipapp.SharedVaultMemberPermissionState]{Status: membershipapp.SharedVaultPermissionUpdateUnavailable}, nil
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
		return membershipapp.SharedVaultPermissionUpdate[membershipapp.SharedVaultMemberPermissionState]{}, fmt.Errorf("update Shared Vault member account permission overrides: %w", err)
	}
	if command.RowsAffected() != 1 {
		var available bool
		if err := transaction.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM vault_members
				WHERE vault_id = $1 AND user_id = $2 AND role = 'VIEWER' AND status = 'ACTIVE'
			)`, vaultID, memberUserID).Scan(&available); err != nil {
			return membershipapp.SharedVaultPermissionUpdate[membershipapp.SharedVaultMemberPermissionState]{}, fmt.Errorf("check active Shared Vault member permission state: %w", err)
		}
		if available {
			return membershipapp.SharedVaultPermissionUpdate[membershipapp.SharedVaultMemberPermissionState]{Status: membershipapp.SharedVaultPermissionUpdateStale}, nil
		}
		return membershipapp.SharedVaultPermissionUpdate[membershipapp.SharedVaultMemberPermissionState]{Status: membershipapp.SharedVaultPermissionUpdateUnavailable}, nil
	}
	var storedOverrides membershipdomain.SharedVaultAccountPermissionOverrides
	var defaults membershipdomain.SharedVaultAccountPermissions
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
		return membershipapp.SharedVaultPermissionUpdate[membershipapp.SharedVaultMemberPermissionState]{}, fmt.Errorf("read updated Shared Vault member permissions: %w", err)
	}
	storedOverrides = membershipdomain.SharedVaultAccountPermissionOverrides{
		CanAddAccounts: nullableBool(canAdd), CanEditAccounts: nullableBool(canEdit), CanDeleteAccounts: nullableBool(canDelete),
	}
	parsedRole, validRole := membershipdomain.ParseSharedVaultMemberRole(role)
	if !validRole {
		return membershipapp.SharedVaultPermissionUpdate[membershipapp.SharedVaultMemberPermissionState]{}, errors.New("updated Shared Vault member has an invalid role")
	}
	if err := audit.AppendVaultAuditEvent(ctx, transaction, audit.VaultAuditAppend{
		VaultID: vaultID, OwnerID: ownerID, ActorUserID: ownerID,
		Action: audit.ActionMemberPermissionsUpdated, TargetID: memberUserID,
	}); err != nil {
		return membershipapp.SharedVaultPermissionUpdate[membershipapp.SharedVaultMemberPermissionState]{}, err
	}
	if err := transaction.Commit(ctx); err != nil {
		return membershipapp.SharedVaultPermissionUpdate[membershipapp.SharedVaultMemberPermissionState]{}, fmt.Errorf("commit Shared Vault member permission update: %w", err)
	}
	return membershipapp.SharedVaultPermissionUpdate[membershipapp.SharedVaultMemberPermissionState]{
		Status: membershipapp.SharedVaultPermissionUpdateUpdated,
		Value: membershipapp.SharedVaultMemberPermissionState{
			Overrides: storedOverrides,
			Effective: membershipdomain.EffectiveSharedVaultAccountPermissionsFor(parsedRole, defaults, storedOverrides),
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

var _ membershipapp.SharedVaultAccountPermissionRepository = (*PostgresSharedVaultAccountPermissionRepository)(nil)
