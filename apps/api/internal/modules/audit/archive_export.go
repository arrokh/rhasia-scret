package audit

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

type PostgreSQLBeginner interface {
	BeginTx(context.Context, pgx.TxOptions) (pgx.Tx, error)
}

// RecordArchiveExport records an owner-only archive export while the active
// Vault row is locked, so a concurrent lifecycle transition cannot race it.
func RecordArchiveExport(ctx context.Context, database PostgreSQLBeginner, ownerID string, vaultID string) (bool, error) {
	if database == nil || ownerID == "" || vaultID == "" {
		return false, errors.New("Vault archive export audit is not configured")
	}
	transaction, err := database.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return false, fmt.Errorf("begin Vault archive export audit: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()

	var lockedVaultID string
	err = transaction.QueryRow(ctx, `
		SELECT id
		FROM vaults
		WHERE id = $1 AND owner_id = $2 AND lifecycle = 'ACTIVE' AND deleted_at IS NULL
		FOR UPDATE`, vaultID, ownerID).Scan(&lockedVaultID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("authorize Vault archive export audit: %w", err)
	}
	if err := AppendVaultAuditEvent(ctx, transaction, VaultAuditAppend{
		VaultID: vaultID, OwnerID: ownerID, ActorUserID: ownerID, Action: ActionArchiveExported,
	}); err != nil {
		return false, err
	}
	if err := transaction.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit Vault archive export audit: %w", err)
	}
	return true, nil
}
