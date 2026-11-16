package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	apiEntity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity"
	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
)

type SharedVaultRecoveryRepository struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewSharedVaultRecoveryRepository(pool *pgxpool.Pool, now func() time.Time) (*SharedVaultRecoveryRepository, error) {
	if pool == nil {
		return nil, errors.New("Shared Vault recovery repository is not configured")
	}
	if now == nil {
		now = time.Now
	}
	return &SharedVaultRecoveryRepository{pool: pool, now: now}, nil
}

func (repository *SharedVaultRecoveryRepository) Delete(ctx context.Context, ownerID string, vaultID string) (bool, error) {
	if ownerID == "" || vaultID == "" {
		return false, nil
	}
	transaction, err := repository.pool.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("begin Shared Vault deletion: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	deletedAt := repository.now()
	purgeAfter := apiEntity.VaultPurgeAfter(deletedAt)
	var deletedVaultID string
	err = transaction.QueryRow(ctx, `
		UPDATE vaults
		SET lifecycle = 'DELETED', deleted_at = $3, purge_after = $4, updated_at = $3
		WHERE id = $1 AND owner_id = $2 AND type = 'SHARED' AND lifecycle = 'ACTIVE' AND deleted_at IS NULL
		RETURNING id`, vaultID, ownerID, deletedAt, purgeAfter).Scan(&deletedVaultID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("soft-delete Shared Vault: %w", err)
	}
	auditRetentionDeadline := deletedAt.AddDate(1, 0, 0)
	if err := updateVaultAuditRetention(ctx, transaction, vaultID, ownerID, &auditRetentionDeadline); err != nil {
		return false, err
	}
	if err := AppendVaultAuditEvent(ctx, transaction, apiEntity.VaultAuditAppend{
		VaultID: vaultID, OwnerID: ownerID, ActorUserID: ownerID, Action: apiEntity.ActionVaultDeleted,
		RetentionPurgeAfter: ptrVaultTime(auditRetentionDeadline),
	}); err != nil {
		return false, err
	}
	if err := transaction.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit Shared Vault deletion: %w", err)
	}
	return true, nil
}

func (repository *SharedVaultRecoveryRepository) Restore(ctx context.Context, ownerID string, vaultID string) (bool, error) {
	if ownerID == "" || vaultID == "" {
		return false, nil
	}
	transaction, err := repository.pool.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("begin Shared Vault restoration: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	now := repository.now()
	legacyCutoff := apiEntity.LegacyVaultRecoveryCutoff(now)
	var restoredVaultID string
	err = transaction.QueryRow(ctx, `
		UPDATE vaults
		SET lifecycle = 'ACTIVE', deleted_at = NULL, purge_after = NULL, updated_at = $2
		WHERE id = $1 AND owner_id = $3 AND type = 'SHARED' AND lifecycle = 'DELETED' AND deleted_at IS NOT NULL
		  AND (purge_after > $2 OR (purge_after IS NULL AND deleted_at > $4))
		RETURNING id`, vaultID, now, ownerID, legacyCutoff).Scan(&restoredVaultID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("restore Shared Vault: %w", err)
	}
	if err := updateVaultAuditRetention(ctx, transaction, vaultID, ownerID, nil); err != nil {
		return false, err
	}
	if err := AppendVaultAuditEvent(ctx, transaction, apiEntity.VaultAuditAppend{
		VaultID: vaultID, OwnerID: ownerID, ActorUserID: ownerID, Action: apiEntity.ActionVaultRestored,
	}); err != nil {
		return false, err
	}
	if err := transaction.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit Shared Vault restoration: %w", err)
	}
	return true, nil
}

func updateVaultAuditRetention(ctx context.Context, transaction pgx.Tx, vaultID string, ownerID string, retention *time.Time) error {
	if _, err := transaction.Exec(ctx, `
		UPDATE vault_audit_events SET owner_id = $2, retention_purge_after = $3 WHERE vault_id = $1`,
		vaultID, ownerID, retention); err != nil {
		return fmt.Errorf("update Shared Vault audit retention: %w", err)
	}
	return nil
}

func ptrVaultTime(value time.Time) *time.Time {
	return &value
}

var _ apiService.SharedVaultRecoveryRepository = (*SharedVaultRecoveryRepository)(nil)
