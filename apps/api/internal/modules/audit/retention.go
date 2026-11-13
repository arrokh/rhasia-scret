package audit

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// SetVaultAuditRetention preserves a deleted Shared Vault's audit events for the independent retention window.
func SetVaultAuditRetention(ctx context.Context, transaction pgx.Tx, vaultID, ownerID string, retainUntil time.Time) error {
	if transaction == nil || vaultID == "" || ownerID == "" {
		return errors.New("Vault audit retention update is invalid")
	}
	if _, err := transaction.Exec(ctx, `
		UPDATE vault_audit_events SET owner_id = $2, retention_purge_after = $3 WHERE vault_id = $1`,
		vaultID, ownerID, retainUntil); err != nil {
		return fmt.Errorf("set Vault audit retention: %w", err)
	}
	return nil
}

type auditRetentionQueryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

// PurgeExpiredVaultAuditEvents deletes one oldest-first batch without blocking concurrent retention workers.
func PurgeExpiredVaultAuditEvents(ctx context.Context, database auditRetentionQueryer, now time.Time, batchSize int) ([]string, error) {
	if database == nil || batchSize < 1 || batchSize > 500 {
		return nil, errors.New("Vault audit purge request is invalid")
	}
	rows, err := database.Query(ctx, `
		DELETE FROM vault_audit_events
		WHERE id IN (
			SELECT id FROM vault_audit_events
			WHERE retention_purge_after IS NOT NULL AND retention_purge_after <= $1
			ORDER BY retention_purge_after, id
			FOR UPDATE SKIP LOCKED
			LIMIT $2
		)
		RETURNING id`, now, batchSize)
	if err != nil {
		return nil, fmt.Errorf("purge expired Vault audit events: %w", err)
	}
	defer rows.Close()
	ids := make([]string, 0, batchSize)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan purged Vault audit event: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate purged Vault audit events: %w", err)
	}
	return ids, nil
}
