package infrastructure

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	accountdomain "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity/authenticator-account"
	vaultdomain "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity/vault-management"
	audit "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/audit"
)

type PostgresRetentionPurgeRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRetentionPurgeRepository(pool *pgxpool.Pool) (*PostgresRetentionPurgeRepository, error) {
	if pool == nil {
		return nil, errors.New("retention purge repository is not configured")
	}
	return &PostgresRetentionPurgeRepository{pool: pool}, nil
}

func (repository *PostgresRetentionPurgeRepository) PurgeExpiredAccounts(ctx context.Context, now time.Time, batchSize int) ([]string, error) {
	if batchSize < 1 || batchSize > 500 {
		return nil, errors.New("account retention purge batch size is invalid")
	}
	rows, err := repository.pool.Query(ctx, `
		WITH explicit_deadlines AS MATERIALIZED (
			SELECT id FROM authenticator_accounts
			WHERE deleted_at IS NOT NULL AND purge_after IS NOT NULL AND purge_after <= $1
			ORDER BY purge_after, id
			FOR UPDATE SKIP LOCKED
			LIMIT $3
		), legacy_deadlines AS MATERIALIZED (
			SELECT id FROM authenticator_accounts
			WHERE deleted_at IS NOT NULL AND purge_after IS NULL
			  AND deleted_at + ($2 * INTERVAL '1 day') <= $1
			ORDER BY id
			FOR UPDATE SKIP LOCKED
			LIMIT GREATEST($3 - (SELECT count(*) FROM explicit_deadlines), 0)
		), expired AS (
			SELECT id FROM explicit_deadlines
			UNION ALL
			SELECT id FROM legacy_deadlines
		)
		DELETE FROM authenticator_accounts AS account
		WHERE account.id IN (SELECT id FROM expired)
		RETURNING account.id`, now, accountdomain.AccountRecoveryWindow/(24*time.Hour), batchSize)
	if err != nil {
		return nil, fmt.Errorf("purge expired authenticator accounts: %w", err)
	}
	return collectIDs(rows, "expired authenticator account")
}

func (repository *PostgresRetentionPurgeRepository) PurgeExpiredVaults(ctx context.Context, now time.Time, batchSize int) ([]string, error) {
	if batchSize < 1 || batchSize > 500 {
		return nil, errors.New("Shared Vault retention purge batch size is invalid")
	}
	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return nil, fmt.Errorf("begin Shared Vault retention purge: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	rows, err := transaction.Query(ctx, `
		WITH explicit_deadlines AS MATERIALIZED (
			SELECT id, owner_id, deleted_at FROM vaults
			WHERE type = 'SHARED' AND lifecycle = 'DELETED' AND deleted_at IS NOT NULL
			  AND purge_after IS NOT NULL AND purge_after <= $1
			ORDER BY purge_after, id
			FOR UPDATE SKIP LOCKED
			LIMIT $3
		), legacy_deadlines AS MATERIALIZED (
			SELECT id, owner_id, deleted_at FROM vaults
			WHERE type = 'SHARED' AND lifecycle = 'DELETED' AND deleted_at IS NOT NULL
			  AND purge_after IS NULL AND deleted_at + ($2 * INTERVAL '1 day') <= $1
			ORDER BY id
			FOR UPDATE SKIP LOCKED
			LIMIT GREATEST($3 - (SELECT count(*) FROM explicit_deadlines), 0)
		)
		SELECT id, owner_id, deleted_at FROM explicit_deadlines
		UNION ALL
		SELECT id, owner_id, deleted_at FROM legacy_deadlines`, now, vaultdomain.VaultRecoveryDays, batchSize)
	if err != nil {
		return nil, fmt.Errorf("select expired Shared Vaults: %w", err)
	}
	type expiredVault struct {
		id        string
		ownerID   string
		deletedAt time.Time
	}
	vaults := make([]expiredVault, 0, batchSize)
	for rows.Next() {
		var vault expiredVault
		if err := rows.Scan(&vault.id, &vault.ownerID, &vault.deletedAt); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan expired Shared Vault: %w", err)
		}
		vaults = append(vaults, vault)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, fmt.Errorf("iterate expired Shared Vaults: %w", err)
	}
	rows.Close()
	if len(vaults) == 0 {
		if err := transaction.Commit(ctx); err != nil {
			return nil, fmt.Errorf("commit empty Shared Vault retention purge: %w", err)
		}
		return []string{}, nil
	}
	vaultIDs := make([]string, 0, len(vaults))
	for _, vault := range vaults {
		vaultIDs = append(vaultIDs, vault.id)
		if err := audit.SetVaultAuditRetention(ctx, transaction, vault.id, vault.ownerID, audit.AuditPurgeAfter(vault.deletedAt)); err != nil {
			return nil, err
		}
	}
	for _, statement := range []string{
		`DELETE FROM authenticator_accounts WHERE vault_id = ANY($1::text[])`,
		`DELETE FROM vault_invitations WHERE vault_id = ANY($1::text[])`,
		`DELETE FROM vault_members WHERE vault_id = ANY($1::text[])`,
	} {
		if _, err := transaction.Exec(ctx, statement, vaultIDs); err != nil {
			return nil, fmt.Errorf("remove expired Shared Vault dependents: %w", err)
		}
	}
	command, err := transaction.Exec(ctx, `DELETE FROM vaults WHERE id = ANY($1::text[]) AND type = 'SHARED' AND lifecycle = 'DELETED'`, vaultIDs)
	if err != nil {
		return nil, fmt.Errorf("delete expired Shared Vaults: %w", err)
	}
	if command.RowsAffected() != int64(len(vaultIDs)) {
		return nil, errors.New("expired Shared Vault purge lost its row-lock invariant")
	}
	if err := transaction.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit expired Shared Vault purge: %w", err)
	}
	return vaultIDs, nil
}

func (repository *PostgresRetentionPurgeRepository) PurgeExpiredAuditEvents(ctx context.Context, now time.Time, batchSize int) ([]string, error) {
	return audit.PurgeExpiredVaultAuditEvents(ctx, repository.pool, now, batchSize)
}

func (repository *PostgresRetentionPurgeRepository) PurgeExpiredAuthState(ctx context.Context, now time.Time, batchSize int, maxBatches int) (int64, bool, error) {
	if batchSize < 1 || batchSize > 500 || maxBatches < 1 || maxBatches > 20 {
		return 0, false, errors.New("auth-state retention purge bounds are invalid")
	}
	var total int64
	backlogRemaining := false
	for batch := 0; batch < maxBatches; batch++ {
		transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
		if err != nil {
			return 0, false, fmt.Errorf("begin expired auth-state purge batch: %w", err)
		}
		batchFull := false
		for _, operation := range []struct {
			table string
			where string
		}{
			{table: "magic_link_challenges", where: "expires_at <= $1"},
			{table: "pwa_authentication_handoffs", where: "expires_at <= $1"},
			{table: "account_deletion_challenges", where: "expires_at <= $1"},
			{table: "auth_sessions", where: "refresh_expires_at <= $1 OR revoked_at IS NOT NULL"},
			{table: "anonymous_auth_rate_limit_windows", where: "expires_at <= $1"},
		} {
			statement := fmt.Sprintf(`
				DELETE FROM %s
				WHERE ctid IN (
					SELECT ctid FROM %s
					WHERE %s
					ORDER BY ctid
					FOR UPDATE SKIP LOCKED
					LIMIT $2
				)`, operation.table, operation.table, operation.where)
			command, err := transaction.Exec(ctx, statement, now, batchSize)
			if err != nil {
				_ = transaction.Rollback(ctx)
				return 0, false, fmt.Errorf("purge expired %s: %w", operation.table, err)
			}
			deleted := command.RowsAffected()
			total += deleted
			batchFull = batchFull || deleted == int64(batchSize)
		}
		if err := transaction.Commit(ctx); err != nil {
			return 0, false, fmt.Errorf("commit expired auth-state purge batch: %w", err)
		}
		backlogRemaining = batchFull
		if !backlogRemaining {
			return total, false, nil
		}
	}
	return total, backlogRemaining, nil
}

func collectIDs(rows pgx.Rows, label string) ([]string, error) {
	defer rows.Close()
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan purged %s: %w", label, err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate purged %s rows: %w", label, err)
	}
	return ids, nil
}
