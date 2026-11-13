package infrastructure

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	membershipapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-membership/application"
)

type PostgresMembershipLifecycleRepository struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewPostgresMembershipLifecycleRepository(pool *pgxpool.Pool, now func() time.Time) (*PostgresMembershipLifecycleRepository, error) {
	if pool == nil {
		return nil, errors.New("Shared Vault membership lifecycle repository is not configured")
	}
	if now == nil {
		now = time.Now
	}
	return &PostgresMembershipLifecycleRepository{pool: pool, now: now}, nil
}

func (repository *PostgresMembershipLifecycleRepository) Revoke(
	ctx context.Context,
	ownerID string,
	vaultID string,
	memberUserID string,
) error {
	if ownerID == "" || vaultID == "" || memberUserID == "" || ownerID == memberUserID {
		return membershipapp.ErrMembershipUnavailable
	}
	transaction, err := repository.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin Shared Vault membership revocation: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	if _, err := transaction.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, memberUserID); err != nil {
		return fmt.Errorf("lock Shared Vault membership revocation: %w", err)
	}
	var lockedVaultID string
	err = transaction.QueryRow(ctx, `
		SELECT id
		FROM vaults
		WHERE id = $1 AND owner_id = $2 AND type = 'SHARED' AND lifecycle = 'ACTIVE' AND deleted_at IS NULL
		FOR UPDATE`, vaultID, ownerID).Scan(&lockedVaultID)
	if errors.Is(err, pgx.ErrNoRows) {
		return membershipapp.ErrMembershipUnavailable
	}
	if err != nil {
		return fmt.Errorf("lock owner Shared Vault for membership revocation: %w", err)
	}
	now := repository.now()
	command, err := transaction.Exec(ctx, `
		UPDATE vault_members
		SET status = 'REVOKED', revoked_at = $3, updated_at = $3,
		    can_add_accounts_override = NULL, can_edit_accounts_override = NULL, can_delete_accounts_override = NULL,
		    permissions_revision = permissions_revision + 1
		WHERE vault_id = $1 AND user_id = $2 AND role = 'VIEWER' AND status = 'ACTIVE'`, vaultID, memberUserID, now)
	if err != nil {
		return fmt.Errorf("revoke active Shared Vault membership: %w", err)
	}
	if command.RowsAffected() != 1 {
		return membershipapp.ErrMembershipUnavailable
	}
	if err := transaction.Commit(ctx); err != nil {
		return fmt.Errorf("commit Shared Vault membership revocation: %w", err)
	}
	return nil
}

func (repository *PostgresMembershipLifecycleRepository) Leave(ctx context.Context, viewerID string, vaultID string) error {
	if viewerID == "" || vaultID == "" {
		return membershipapp.ErrMembershipUnavailable
	}
	transaction, err := repository.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin Shared Vault leave: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	if _, err := transaction.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, viewerID); err != nil {
		return fmt.Errorf("lock Shared Vault leave: %w", err)
	}
	var lockedVaultID string
	err = transaction.QueryRow(ctx, `
		SELECT id
		FROM vaults
		WHERE id = $1 AND type = 'SHARED' AND lifecycle = 'ACTIVE' AND deleted_at IS NULL
		FOR UPDATE`, vaultID).Scan(&lockedVaultID)
	if errors.Is(err, pgx.ErrNoRows) {
		return membershipapp.ErrMembershipUnavailable
	}
	if err != nil {
		return fmt.Errorf("lock Shared Vault for leave: %w", err)
	}
	now := repository.now()
	command, err := transaction.Exec(ctx, `
		UPDATE vault_members
		SET status = 'LEFT', revoked_at = $3, updated_at = $3,
		    can_add_accounts_override = NULL, can_edit_accounts_override = NULL, can_delete_accounts_override = NULL,
		    permissions_revision = permissions_revision + 1
		WHERE vault_id = $1 AND user_id = $2 AND role = 'VIEWER' AND status = 'ACTIVE'`, vaultID, viewerID, now)
	if err != nil {
		return fmt.Errorf("leave Shared Vault membership: %w", err)
	}
	if command.RowsAffected() != 1 {
		return membershipapp.ErrMembershipUnavailable
	}
	if err := transaction.Commit(ctx); err != nil {
		return fmt.Errorf("commit Shared Vault leave: %w", err)
	}
	return nil
}

var _ membershipapp.MembershipLifecycleRepository = (*PostgresMembershipLifecycleRepository)(nil)
