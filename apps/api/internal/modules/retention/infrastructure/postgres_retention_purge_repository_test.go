package infrastructure

import (
	"context"
	"crypto/sha256"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/audit"
	accountdomain "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/authenticator-account/domain"
	vaultdomain "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-management/domain"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/postgres"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

func TestPostgresRetentionPurgeBoundsAuthStateAndReportsBacklog(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	repository, err := NewPostgresRetentionPurgeRepository(pool)
	if err != nil {
		t.Fatalf("create retention purge repository: %v", err)
	}
	prefix, err := postgres.NewCUID()
	if err != nil {
		t.Fatalf("create synthetic auth-state ID prefix: %v", err)
	}
	ids := make([]string, 25)
	now := retentionTestNow
	for index := range ids {
		ids[index] = fmt.Sprintf("synthetic-%s-%d", prefix, index)
		digest := sha256.Sum256([]byte(ids[index]))
		if _, err := pool.Exec(ctx, `
			INSERT INTO magic_link_challenges
				(id, normalized_email, purpose, token_digest, client, return_path, expires_at, created_at)
			VALUES ($1, $2, 'sign_in', $3, 'browser', '/', $4, $4)`,
			ids[index], fmt.Sprintf("retention-%d@example.test", index), digest[:], now.Add(-time.Hour)); err != nil {
			t.Fatalf("insert synthetic expired magic-link challenge: %v", err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM magic_link_challenges WHERE id = ANY($1::text[])`, ids)
	})

	firstCount, backlog, err := repository.PurgeExpiredAuthState(ctx, now, 10, 2)
	if err != nil || firstCount < 20 || firstCount > 100 || !backlog {
		t.Fatalf("first bounded auth purge count=%d backlog=%t err=%v; want at least 20 and no more than 100 with backlog", firstCount, backlog, err)
	}
	var remaining int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM magic_link_challenges WHERE id = ANY($1::text[])`, ids).Scan(&remaining); err != nil || remaining != 5 {
		t.Fatalf("remaining expired synthetic challenges=%d err=%v; want 5", remaining, err)
	}

	secondCount, _, err := repository.PurgeExpiredAuthState(ctx, now, 10, 2)
	if err != nil || secondCount < 5 || secondCount > 100 {
		t.Fatalf("second bounded auth purge count=%d err=%v; want at least 5 and no more than 100", secondCount, err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM magic_link_challenges WHERE id = ANY($1::text[])`, ids).Scan(&remaining); err != nil || remaining != 0 {
		t.Fatalf("remaining expired synthetic challenges after second purge=%d err=%v; want 0", remaining, err)
	}
}

func TestPostgresRetentionPurgeAccountsAndConcurrentBatches(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := retentionTestNow
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	vaultID := mustRetentionVault(t, ctx, pool, ownerID, "ACTIVE", nil, nil, now)
	t.Cleanup(func() { cleanupRetentionVault(t, ctx, pool, vaultID) })
	repository, err := NewPostgresRetentionPurgeRepository(pool)
	if err != nil {
		t.Fatalf("create retention purge repository: %v", err)
	}

	expiredDeletedAt := now.Add(-(accountdomain.AccountRecoveryWindow + 24*time.Hour))
	explicitExpiredID := mustRetentionID(t)
	legacyExpiredID := mustRetentionID(t)
	futureID := mustRetentionID(t)
	activeID := mustRetentionID(t)
	futureDeletedAt := now.Add(-time.Hour)
	futurePurgeAfter := futureDeletedAt.Add(accountdomain.AccountRecoveryWindow)
	explicitPurgeAfter := now.Add(-time.Hour)
	insertRetentionAccount(t, ctx, pool, vaultID, explicitExpiredID, &expiredDeletedAt, &explicitPurgeAfter, now)
	insertRetentionAccount(t, ctx, pool, vaultID, legacyExpiredID, &expiredDeletedAt, nil, now)
	insertRetentionAccount(t, ctx, pool, vaultID, futureID, &futureDeletedAt, &futurePurgeAfter, now)
	insertRetentionAccount(t, ctx, pool, vaultID, activeID, nil, nil, now)
	purged, err := repository.PurgeExpiredAccounts(ctx, now, 1)
	if err != nil || len(purged) != 1 || purged[0] != explicitExpiredID {
		t.Fatalf("first bounded account purge=%v err=%v; want explicit deadline %q", purged, err, explicitExpiredID)
	}
	purged, err = repository.PurgeExpiredAccounts(ctx, now, 1)
	if err != nil || len(purged) != 1 || purged[0] != legacyExpiredID {
		t.Fatalf("legacy-deadline account purge=%v err=%v; want %q", purged, err, legacyExpiredID)
	}
	purged, err = repository.PurgeExpiredAccounts(ctx, now, 1)
	if err != nil || len(purged) != 0 {
		t.Fatalf("account purge beyond expired set=%v err=%v; want empty", purged, err)
	}
	var remaining int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM authenticator_accounts WHERE id = ANY($1::text[])`, []string{futureID, activeID}).Scan(&remaining); err != nil || remaining != 2 {
		t.Fatalf("nonexpired/active accounts remaining=%d err=%v; want 2", remaining, err)
	}

	concurrentIDs := make([]string, 12)
	for index := range concurrentIDs {
		concurrentIDs[index] = mustRetentionID(t)
		insertRetentionAccount(t, ctx, pool, vaultID, concurrentIDs[index], &expiredDeletedAt, &explicitPurgeAfter, now)
	}
	start := make(chan struct{})
	results := make(chan []string, 2)
	errorsFound := make(chan error, 2)
	var workers sync.WaitGroup
	for range 2 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			ids, purgeErr := repository.PurgeExpiredAccounts(ctx, now, 3)
			results <- ids
			errorsFound <- purgeErr
		}()
	}
	close(start)
	workers.Wait()
	close(results)
	close(errorsFound)
	deleted := make(map[string]struct{}, 6)
	for purgeErr := range errorsFound {
		if purgeErr != nil {
			t.Fatalf("concurrent account purge: %v", purgeErr)
		}
	}
	for ids := range results {
		if len(ids) != 3 {
			t.Fatalf("concurrent account purge deleted %d rows; want 3: %v", len(ids), ids)
		}
		for _, id := range ids {
			if _, exists := deleted[id]; exists {
				t.Fatalf("concurrent account purges returned duplicate ID %q", id)
			}
			deleted[id] = struct{}{}
		}
	}
	if len(deleted) != 6 {
		t.Fatalf("concurrent account purges deleted %d unique rows; want 6", len(deleted))
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM authenticator_accounts WHERE id = ANY($1::text[])`, concurrentIDs).Scan(&remaining); err != nil || remaining != 6 {
		t.Fatalf("concurrent account purge left %d rows err=%v; want 6", remaining, err)
	}
}

func TestPostgresRetentionPurgeVaultDependentsAndAuditRetention(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := retentionTestNow
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	repository, err := NewPostgresRetentionPurgeRepository(pool)
	if err != nil {
		t.Fatalf("create retention purge repository: %v", err)
	}
	explicitDeletedAt := now.Add(-(time.Duration(vaultdomain.VaultRecoveryDays)*24*time.Hour + 24*time.Hour))
	legacyDeletedAt := explicitDeletedAt.Add(-24 * time.Hour)
	futureDeletedAt := now.Add(-48 * time.Hour)
	explicitVaultID := mustRetentionVault(t, ctx, pool, ownerID, "DELETED", &explicitDeletedAt, timePtr(now.Add(-time.Hour)), now)
	legacyVaultID := mustRetentionVault(t, ctx, pool, ownerID, "DELETED", &legacyDeletedAt, nil, now)
	futureVaultID := mustRetentionVault(t, ctx, pool, ownerID, "DELETED", &futureDeletedAt, timePtr(futureDeletedAt.Add(time.Duration(vaultdomain.VaultRecoveryDays)*24*time.Hour)), now)
	activeVaultID := mustRetentionVault(t, ctx, pool, ownerID, "ACTIVE", nil, nil, now)
	vaultIDs := []string{explicitVaultID, legacyVaultID, futureVaultID, activeVaultID}
	t.Cleanup(func() {
		if _, err := pool.Exec(ctx, `DELETE FROM vault_audit_events WHERE vault_id = ANY($1::text[])`, vaultIDs); err != nil {
			t.Errorf("delete synthetic retention audit events: %v", err)
		}
		for _, vaultID := range vaultIDs {
			cleanupRetentionVault(t, ctx, pool, vaultID)
		}
	})

	explicitAccountID := insertRetentionDependents(t, ctx, pool, explicitVaultID, now)
	legacyAccountID := insertRetentionDependents(t, ctx, pool, legacyVaultID, now)
	futureAccountID := insertRetentionDependents(t, ctx, pool, futureVaultID, now)
	explicitAuditID := mustRetentionID(t)
	legacyAuditID := mustRetentionID(t)
	insertRetentionAuditEvent(t, ctx, pool, explicitAuditID, explicitVaultID, ownerID, nil, now)
	insertRetentionAuditEvent(t, ctx, pool, legacyAuditID, legacyVaultID, ownerID, nil, now)

	purged, err := repository.PurgeExpiredVaults(ctx, now, 1)
	if err != nil || len(purged) != 1 || purged[0] != explicitVaultID {
		t.Fatalf("first bounded Shared Vault purge=%v err=%v; want explicit deadline %q", purged, err, explicitVaultID)
	}
	assertRetentionVaultGone(t, ctx, pool, explicitVaultID, explicitAccountID)
	assertRetainedAuditDeadline(t, ctx, pool, explicitAuditID, ownerID, audit.AuditPurgeAfter(explicitDeletedAt))
	purged, err = repository.PurgeExpiredVaults(ctx, now, 1)
	if err != nil || len(purged) != 1 || purged[0] != legacyVaultID {
		t.Fatalf("legacy-deadline Shared Vault purge=%v err=%v; want %q", purged, err, legacyVaultID)
	}
	assertRetentionVaultGone(t, ctx, pool, legacyVaultID, legacyAccountID)
	assertRetainedAuditDeadline(t, ctx, pool, legacyAuditID, ownerID, audit.AuditPurgeAfter(legacyDeletedAt))
	purged, err = repository.PurgeExpiredVaults(ctx, now, 1)
	if err != nil || len(purged) != 0 {
		t.Fatalf("Shared Vault purge beyond expired set=%v err=%v; want empty", purged, err)
	}
	var retained int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM vaults WHERE id = ANY($1::text[])`, []string{futureVaultID, activeVaultID}).Scan(&retained); err != nil || retained != 2 {
		t.Fatalf("future/active Shared Vaults remaining=%d err=%v; want 2", retained, err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM authenticator_accounts WHERE id = $1`, futureAccountID).Scan(&retained); err != nil || retained != 1 {
		t.Fatalf("future Vault account remaining=%d err=%v; want 1", retained, err)
	}
	if purged, err := repository.PurgeExpiredAuditEvents(ctx, now, 1); err != nil || len(purged) != 0 {
		t.Fatalf("premature audit purge=%v err=%v; want retained history", purged, err)
	}
	purged, err = repository.PurgeExpiredAuditEvents(ctx, audit.AuditPurgeAfter(legacyDeletedAt), 1)
	if err != nil || len(purged) != 1 || purged[0] != legacyAuditID {
		t.Fatalf("expired legacy audit purge=%v err=%v; want %q", purged, err, legacyAuditID)
	}
	purged, err = repository.PurgeExpiredAuditEvents(ctx, audit.AuditPurgeAfter(explicitDeletedAt), 1)
	if err != nil || len(purged) != 1 || purged[0] != explicitAuditID {
		t.Fatalf("expired explicit audit purge=%v err=%v; want %q", purged, err, explicitAuditID)
	}
}

func TestPostgresRetentionAuditPurgeUsesConcurrentBoundedBatches(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := retentionTestNow
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	vaultID := mustRetentionVault(t, ctx, pool, ownerID, "ACTIVE", nil, nil, now)
	t.Cleanup(func() { cleanupRetentionVault(t, ctx, pool, vaultID) })
	ids := make([]string, 8)
	for index := range ids {
		ids[index] = mustRetentionID(t)
		insertRetentionAuditEvent(t, ctx, pool, ids[index], vaultID, ownerID, timePtr(now.Add(-time.Hour)), now)
	}
	repository, err := NewPostgresRetentionPurgeRepository(pool)
	if err != nil {
		t.Fatalf("create retention purge repository: %v", err)
	}
	start := make(chan struct{})
	results := make(chan []string, 2)
	errorsFound := make(chan error, 2)
	var workers sync.WaitGroup
	for range 2 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			purged, purgeErr := repository.PurgeExpiredAuditEvents(ctx, now, 3)
			results <- purged
			errorsFound <- purgeErr
		}()
	}
	close(start)
	workers.Wait()
	close(results)
	close(errorsFound)
	deleted := make(map[string]struct{}, 6)
	for purgeErr := range errorsFound {
		if purgeErr != nil {
			t.Fatalf("concurrent audit purge: %v", purgeErr)
		}
	}
	for purged := range results {
		if len(purged) != 3 {
			t.Fatalf("concurrent audit purge deleted %d rows; want 3: %v", len(purged), purged)
		}
		for _, id := range purged {
			if _, exists := deleted[id]; exists {
				t.Fatalf("concurrent audit purges returned duplicate ID %q", id)
			}
			deleted[id] = struct{}{}
		}
	}
	if len(deleted) != 6 {
		t.Fatalf("concurrent audit purges deleted %d unique rows; want 6", len(deleted))
	}
	var remaining int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM vault_audit_events WHERE id = ANY($1::text[])`, ids).Scan(&remaining); err != nil || remaining != 2 {
		t.Fatalf("concurrent audit purge left %d rows err=%v; want 2", remaining, err)
	}
}

func insertRetentionDependents(t *testing.T, ctx context.Context, pool *pgxpool.Pool, vaultID string, now time.Time) string {
	t.Helper()
	accountID := mustRetentionID(t)
	insertRetentionAccount(t, ctx, pool, vaultID, accountID, nil, nil, now)
	invitationID := mustRetentionID(t)
	if _, err := pool.Exec(ctx, `
		INSERT INTO vault_invitations (id, vault_id, link_verifier, encrypted_package, status, expires_at, created_at)
		VALUES ($1, $2, $3, $4, 'PENDING', $5, $5)`, invitationID, vaultID, []byte("synthetic-verifier-"+invitationID), []byte("synthetic-encrypted-invitation"), now.Add(7*24*time.Hour)); err != nil {
		t.Fatalf("insert synthetic retention invitation: %v", err)
	}
	return accountID
}

func mustRetentionVault(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ownerID, lifecycle string, deletedAt, purgeAfter *time.Time, now time.Time) string {
	t.Helper()
	vaultID := mustRetentionID(t)
	if _, err := pool.Exec(ctx, `
		INSERT INTO vaults (id, type, lifecycle, owner_id, encrypted_name, encryption_version, deleted_at, purge_after, created_at, updated_at)
		VALUES ($1, 'SHARED', $2, $3, $4, 1, $5, $6, $7, $7)`,
		vaultID, lifecycle, ownerID, []byte("synthetic-encrypted-vault-name"), deletedAt, purgeAfter, now); err != nil {
		t.Fatalf("insert synthetic retention Vault: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO vault_members (vault_id, user_id, role, status, encrypted_vault_key, key_version, created_at, updated_at)
		VALUES ($1, $2, 'OWNER', 'ACTIVE', $3, 1, $4, $4)`, vaultID, ownerID, []byte("synthetic-encrypted-vault-key-wrap"), now); err != nil {
		t.Fatalf("insert synthetic retention Vault owner: %v", err)
	}
	return vaultID
}

func insertRetentionAccount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, vaultID, accountID string, deletedAt, purgeAfter *time.Time, now time.Time) {
	t.Helper()
	if _, err := pool.Exec(ctx, `
		INSERT INTO authenticator_accounts (id, vault_id, encrypted_payload, encryption_version, revision, deleted_at, purge_after, created_at, updated_at)
		VALUES ($1, $2, $3, 1, 1, $4, $5, $6, $6)`, accountID, vaultID, []byte("synthetic-encrypted-account-payload"), deletedAt, purgeAfter, now); err != nil {
		t.Fatalf("insert synthetic retention account: %v", err)
	}
}

func insertRetentionAuditEvent(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id, vaultID, ownerID string, purgeAfter *time.Time, now time.Time) {
	t.Helper()
	if _, err := pool.Exec(ctx, `
		INSERT INTO vault_audit_events (id, vault_id, actor_user_id, event_type, owner_id, retention_purge_after, created_at)
		VALUES ($1, $2, $3, 'ACCOUNT_ACCESSED', $3, $4, $5)`, id, vaultID, ownerID, purgeAfter, now); err != nil {
		t.Fatalf("insert synthetic retention audit event: %v", err)
	}
}

func assertRetentionVaultGone(t *testing.T, ctx context.Context, pool *pgxpool.Pool, vaultID, accountID string) {
	t.Helper()
	for _, query := range []struct {
		statement string
		args      []any
	}{
		{statement: `SELECT count(*) FROM vaults WHERE id = $1`, args: []any{vaultID}},
		{statement: `SELECT count(*) FROM authenticator_accounts WHERE id = $1`, args: []any{accountID}},
		{statement: `SELECT count(*) FROM vault_members WHERE vault_id = $1`, args: []any{vaultID}},
		{statement: `SELECT count(*) FROM vault_invitations WHERE vault_id = $1`, args: []any{vaultID}},
	} {
		var count int
		if err := pool.QueryRow(ctx, query.statement, query.args...).Scan(&count); err != nil || count != 0 {
			t.Fatalf("purged Vault dependent count=%d err=%v for %q; want 0", count, err, vaultID)
		}
	}
}

func assertRetainedAuditDeadline(t *testing.T, ctx context.Context, pool *pgxpool.Pool, eventID, ownerID string, want time.Time) {
	t.Helper()
	var storedOwnerID string
	var deadline time.Time
	if err := pool.QueryRow(ctx, `SELECT owner_id, retention_purge_after FROM vault_audit_events WHERE id = $1`, eventID).Scan(&storedOwnerID, &deadline); err != nil || storedOwnerID != ownerID || !deadline.Equal(want) {
		t.Fatalf("retained audit owner=%q deadline=%s err=%v; want owner=%q deadline=%s", storedOwnerID, deadline, err, ownerID, want)
	}
}

func cleanupRetentionVault(t *testing.T, ctx context.Context, pool *pgxpool.Pool, vaultID string) {
	t.Helper()
	for _, statement := range []string{
		`DELETE FROM vault_audit_events WHERE vault_id = $1`,
		`DELETE FROM authenticator_accounts WHERE vault_id = $1`,
		`DELETE FROM vault_invitations WHERE vault_id = $1`,
		`DELETE FROM vault_members WHERE vault_id = $1`,
		`DELETE FROM vaults WHERE id = $1`,
	} {
		if _, err := pool.Exec(ctx, statement, vaultID); err != nil {
			t.Errorf("cleanup synthetic retention Vault %q: %v", vaultID, err)
		}
	}
}

// Retention purges scan whole tables, so an ancient synthetic cutoff keeps these fixtures
// independent from newer records written by other packages sharing the disposable database.
var retentionTestNow = time.Date(1900, time.January, 2, 3, 4, 5, 0, time.UTC)

func mustRetentionID(t *testing.T) string {
	t.Helper()
	id, err := postgres.NewCUID()
	if err != nil {
		t.Fatalf("generate synthetic retention record ID: %v", err)
	}
	return id
}

func timePtr(value time.Time) *time.Time {
	return &value
}
