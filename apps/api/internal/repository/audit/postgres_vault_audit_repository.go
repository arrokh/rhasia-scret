package infrastructure

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	auditentity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity/audit"
	auditapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/audit"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

const (
	DefaultVaultAuditPageSize = 20
	MaxVaultAuditPageSize     = 50
)

type PostgresVaultAuditRepository struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewPostgresVaultAuditRepository(pool *pgxpool.Pool, now func() time.Time) (*PostgresVaultAuditRepository, error) {
	if pool == nil {
		return nil, errors.New("Vault audit repository is not configured")
	}
	if now == nil {
		now = time.Now
	}
	return &PostgresVaultAuditRepository{pool: pool, now: now}, nil
}

func (repository *PostgresVaultAuditRepository) RecordAccountAccess(
	ctx context.Context,
	actorUserID string,
	vaultID string,
	accountID string,
) (bool, error) {
	if actorUserID == "" || vaultID == "" || accountID == "" {
		return false, nil
	}
	transaction, err := repository.pool.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("begin Shared Vault account-access audit: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	var ownerID string
	err = transaction.QueryRow(ctx, `
		SELECT vault.owner_id
		FROM vaults AS vault
		JOIN vault_members AS member ON member.vault_id = vault.id
		JOIN authenticator_accounts AS account ON account.vault_id = vault.id
		WHERE vault.id = $1 AND vault.type = 'SHARED' AND vault.lifecycle = 'ACTIVE' AND vault.deleted_at IS NULL
		  AND member.user_id = $2 AND member.status = 'ACTIVE' AND member.role IN ('OWNER', 'VIEWER')
		  AND account.id = $3 AND account.deleted_at IS NULL
		FOR UPDATE OF vault, member, account`, vaultID, actorUserID, accountID).Scan(&ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("authorize Shared Vault account-access audit: %w", err)
	}
	if err := AppendVaultAuditEvent(ctx, transaction, auditentity.VaultAuditAppend{
		VaultID: vaultID, OwnerID: ownerID, ActorUserID: actorUserID, Action: auditentity.ActionAccountAccessed, TargetID: accountID,
	}); err != nil {
		return false, err
	}
	if err := transaction.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit Shared Vault account-access audit: %w", err)
	}
	return true, nil
}

func (repository *PostgresVaultAuditRepository) RecordPersonalAccountCopiesToLocal(
	ctx context.Context,
	ownerID string,
	vaultID string,
	accountIDs []string,
) (bool, error) {
	if ownerID == "" || vaultID == "" || len(accountIDs) == 0 || len(accountIDs) > auditapp.MaxAccountCopyAuditIDs || !uniqueAuditIDs(accountIDs) {
		return false, nil
	}
	transaction, err := repository.pool.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("begin Personal Vault copy audit: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	var lockedVaultID string
	err = transaction.QueryRow(ctx, `
		SELECT id FROM vaults
		WHERE id = $1 AND owner_id = $2 AND type = 'PERSONAL' AND lifecycle = 'ACTIVE' AND deleted_at IS NULL
		FOR UPDATE`, vaultID, ownerID).Scan(&lockedVaultID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("authorize Personal Vault account-copy audit: %w", err)
	}
	rows, err := transaction.Query(ctx, `
		SELECT id FROM authenticator_accounts
		WHERE vault_id = $1 AND id = ANY($2::text[]) AND deleted_at IS NULL
		ORDER BY id ASC FOR UPDATE`, vaultID, accountIDs)
	if err != nil {
		return false, fmt.Errorf("read active Personal Vault accounts for copy audit: %w", err)
	}
	foundIDs := make([]string, 0, len(accountIDs))
	for rows.Next() {
		var accountID string
		if err := rows.Scan(&accountID); err != nil {
			rows.Close()
			return false, fmt.Errorf("scan Personal Vault account for copy audit: %w", err)
		}
		foundIDs = append(foundIDs, accountID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return false, fmt.Errorf("iterate Personal Vault accounts for copy audit: %w", err)
	}
	rows.Close()
	if !sameAuditIDs(foundIDs, accountIDs) {
		return false, nil
	}
	for _, accountID := range accountIDs {
		if err := AppendVaultAuditEvent(ctx, transaction, auditentity.VaultAuditAppend{
			VaultID: vaultID, OwnerID: ownerID, ActorUserID: ownerID, Action: auditentity.ActionAccountCopiedToLocal, TargetID: accountID,
		}); err != nil {
			return false, err
		}
	}
	if err := transaction.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit Personal Vault account-copy audit: %w", err)
	}
	return true, nil
}

func (repository *PostgresVaultAuditRepository) RecordArchiveExport(ctx context.Context, ownerID string, vaultID string) (bool, error) {
	return RecordArchiveExport(ctx, repository.pool, ownerID, vaultID)
}

func (repository *PostgresVaultAuditRepository) ListForOwner(
	ctx context.Context,
	ownerID string,
	vaultID string,
	filter auditapp.VaultAuditFilter,
	request sharedapp.CursorPageRequest,
) (*sharedapp.CursorPage[auditapp.RedactedVaultAuditEvent], error) {
	if ownerID == "" || vaultID == "" {
		return nil, nil
	}
	now := repository.now()
	var lifecycle string
	var deletedAt *time.Time
	err := repository.pool.QueryRow(ctx, `
		SELECT lifecycle, deleted_at
		FROM vaults
		WHERE id = $1 AND owner_id = $2 AND lifecycle IN ('ACTIVE', 'DELETED')`, vaultID, ownerID).Scan(&lifecycle, &deletedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		var retainedCount int64
		if err := repository.pool.QueryRow(ctx, `
			SELECT count(*) FROM vault_audit_events
			WHERE vault_id = $1 AND owner_id = $2 AND retention_purge_after > $3`, vaultID, ownerID, now).Scan(&retainedCount); err != nil {
			return nil, fmt.Errorf("check retained Vault audit history: %w", err)
		}
		if retainedCount == 0 {
			return nil, nil
		}
		lifecycle = "PURGED"
	} else if err != nil {
		return nil, fmt.Errorf("read Vault audit owner scope: %w", err)
	}
	if lifecycle == "DELETED" && (deletedAt == nil || !auditentity.AuditPurgeAfter(*deletedAt).After(now)) {
		return nil, nil
	}
	limit := request.Limit
	if limit < 1 {
		limit = DefaultVaultAuditPageSize
	}
	if limit > MaxVaultAuditPageSize {
		limit = MaxVaultAuditPageSize
	}
	var accountID any
	if filter.AccountID != nil {
		accountID = *filter.AccountID
	}
	var actorUserID any
	if filter.ActorUserID != nil {
		actorUserID = *filter.ActorUserID
	}
	query := `
		SELECT event.id, event.event_type, event.target_id, event.actor_user_id, actor.email, event.created_at
		FROM vault_audit_events AS event
		JOIN application_users AS actor ON actor.id = event.actor_user_id
		WHERE event.vault_id = $1
		  AND ($3::text IS NULL OR event.target_id = $3)
		  AND ($4::text IS NULL OR event.actor_user_id = $4)`
	switch lifecycle {
	case "ACTIVE":
		query += ` AND (event.owner_id = $2 OR event.owner_id IS NULL)`
	case "DELETED":
		query += ` AND ((event.owner_id = $2 AND event.retention_purge_after > $5) OR (event.owner_id IS NULL AND event.retention_purge_after IS NULL))`
	default:
		query += ` AND event.owner_id = $2 AND event.retention_purge_after > $5`
	}
	arguments := []any{vaultID, ownerID, accountID, actorUserID}
	if lifecycle != "ACTIVE" {
		arguments = append(arguments, now)
	}
	if request.Cursor != nil {
		createdAtParameter := len(arguments) + 1
		keyParameter := createdAtParameter + 1
		query += fmt.Sprintf(" AND (event.created_at < $%d OR (event.created_at = $%d AND event.id < $%d))", createdAtParameter, createdAtParameter, keyParameter)
		arguments = append(arguments, request.Cursor.CreatedAt, request.Cursor.Key)
	}
	query += fmt.Sprintf(" ORDER BY event.created_at DESC, event.id DESC LIMIT $%d", len(arguments)+1)
	arguments = append(arguments, limit+1)
	rows, err := repository.pool.Query(ctx, query, arguments...)
	if err != nil {
		return nil, fmt.Errorf("list owner Vault audit events: %w", err)
	}
	defer rows.Close()
	events := make([]auditapp.RedactedVaultAuditEvent, 0, limit+1)
	for rows.Next() {
		var event auditapp.RedactedVaultAuditEvent
		var eventType string
		if err := rows.Scan(&event.ID, &eventType, &event.TargetID, &event.ActorUserID, &event.ActorEmail, &event.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan owner Vault audit event: %w", err)
		}
		event.EventType = string(auditentity.RedactAction(eventType))
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate owner Vault audit events: %w", err)
	}
	page := sharedapp.BuildCursorPage(events, limit, func(event auditapp.RedactedVaultAuditEvent) sharedapp.TimestampCursor {
		return sharedapp.TimestampCursor{CreatedAt: event.CreatedAt, Key: event.ID}
	})
	return &page, nil
}

func uniqueAuditIDs(values []string) bool {
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if value == "" {
			return false
		}
		if _, exists := seen[value]; exists {
			return false
		}
		seen[value] = struct{}{}
	}
	return true
}

func sameAuditIDs(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	seen := make(map[string]struct{}, len(left))
	for _, value := range left {
		if _, exists := seen[value]; exists {
			return false
		}
		seen[value] = struct{}{}
	}
	for _, value := range right {
		if _, exists := seen[value]; !exists {
			return false
		}
		delete(seen, value)
	}
	return len(seen) == 0
}

var _ auditapp.VaultAuditRepository = (*PostgresVaultAuditRepository)(nil)
