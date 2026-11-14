package repository

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	apiEntity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

func TestSharedVaultRecoveryKeepsAuditRetentionIndependent(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	deletedAt := time.Date(2026, time.January, 31, 23, 45, 0, 0, time.UTC)
	now := deletedAt
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	outsiderID := testsupport.CreateSyntheticApplicationUser(t, pool)
	vaultID := insertRecoveryVault(t, ctx, pool, ownerID, "ACTIVE", nil, nil, deletedAt)
	legacyAuditID := mustRecoveryID(t)
	if _, err := pool.Exec(ctx, `
		INSERT INTO vault_audit_events (id, vault_id, actor_user_id, event_type, created_at)
		VALUES ($1, $2, $3, 'ACCOUNT_ACCESSED', $4)`, legacyAuditID, vaultID, ownerID, deletedAt.Add(-time.Hour)); err != nil {
		t.Fatalf("insert synthetic legacy audit event: %v", err)
	}
	t.Cleanup(func() { deleteSyntheticSharedVault(t, ctx, pool, vaultID) })
	repository, err := NewSharedVaultRecoveryRepository(pool, func() time.Time { return now })
	if err != nil {
		t.Fatalf("create Shared Vault recovery repository: %v", err)
	}
	if changed, err := repository.Delete(ctx, outsiderID, vaultID); err != nil || changed {
		t.Fatalf("non-owner delete changed=%t err=%v; want unavailable", changed, err)
	}
	if changed, err := repository.Delete(ctx, ownerID, vaultID); err != nil || !changed {
		t.Fatalf("owner delete changed=%t err=%v; want deleted", changed, err)
	}
	purgeAfter := apiEntity.VaultPurgeAfter(deletedAt)
	auditDeadline := deletedAt.AddDate(1, 0, 0)
	var lifecycle string
	var storedDeletedAt, storedPurgeAfter *time.Time
	if err := pool.QueryRow(ctx, `SELECT lifecycle, deleted_at, purge_after FROM vaults WHERE id = $1`, vaultID).Scan(&lifecycle, &storedDeletedAt, &storedPurgeAfter); err != nil {
		t.Fatalf("read deleted Shared Vault: %v", err)
	}
	if lifecycle != "DELETED" || storedDeletedAt == nil || !storedDeletedAt.Equal(deletedAt) || storedPurgeAfter == nil || !storedPurgeAfter.Equal(purgeAfter) {
		t.Fatalf("deleted Vault lifecycle=%q deletedAt=%v purgeAfter=%v", lifecycle, storedDeletedAt, storedPurgeAfter)
	}
	var legacyOwnerID *string
	var legacyRetention *time.Time
	if err := pool.QueryRow(ctx, `SELECT owner_id, retention_purge_after FROM vault_audit_events WHERE id = $1`, legacyAuditID).Scan(&legacyOwnerID, &legacyRetention); err != nil {
		t.Fatalf("read retained legacy audit event: %v", err)
	}
	if legacyOwnerID == nil || *legacyOwnerID != ownerID || legacyRetention == nil || !legacyRetention.Equal(auditDeadline) {
		t.Fatalf("legacy audit owner=%v retention=%v; want owner-scoped one-year deadline %v", legacyOwnerID, legacyRetention, auditDeadline)
	}
	var deletionEvents int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM vault_audit_events
		WHERE vault_id = $1 AND event_type = 'VAULT_DELETED' AND owner_id = $2 AND actor_user_id = $2
		  AND retention_purge_after = $3`, vaultID, ownerID, auditDeadline).Scan(&deletionEvents); err != nil || deletionEvents != 1 {
		t.Fatalf("Vault deletion audit count=%d err=%v; want one event with independent audit deadline", deletionEvents, err)
	}
	if changed, err := repository.Restore(ctx, outsiderID, vaultID); err != nil || changed {
		t.Fatalf("non-owner restore changed=%t err=%v; want unavailable", changed, err)
	}
	now = deletedAt.Add(29 * 24 * time.Hour)
	if changed, err := repository.Restore(ctx, ownerID, vaultID); err != nil || !changed {
		t.Fatalf("owner restore changed=%t err=%v; want restored before purge", changed, err)
	}
	if err := pool.QueryRow(ctx, `SELECT lifecycle, deleted_at, purge_after FROM vaults WHERE id = $1`, vaultID).Scan(&lifecycle, &storedDeletedAt, &storedPurgeAfter); err != nil {
		t.Fatalf("read restored Shared Vault: %v", err)
	}
	if lifecycle != "ACTIVE" || storedDeletedAt != nil || storedPurgeAfter != nil {
		t.Fatalf("restored Vault lifecycle=%q deletedAt=%v purgeAfter=%v", lifecycle, storedDeletedAt, storedPurgeAfter)
	}
	var retainedAuditCount int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM vault_audit_events WHERE vault_id = $1 AND owner_id = $2 AND retention_purge_after IS NOT NULL`,
		vaultID, ownerID).Scan(&retainedAuditCount); err != nil || retainedAuditCount != 0 {
		t.Fatalf("restored Vault retained audit rows=%d err=%v; want cleared deadlines", retainedAuditCount, err)
	}
	var restoredEvents int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM vault_audit_events WHERE vault_id = $1 AND event_type = 'VAULT_RESTORED' AND owner_id = $2`, vaultID, ownerID).Scan(&restoredEvents); err != nil || restoredEvents != 1 {
		t.Fatalf("Vault restoration audit count=%d err=%v; want one", restoredEvents, err)
	}

	expiredVaultID := insertRecoveryVault(t, ctx, pool, ownerID, "DELETED", &deletedAt, &purgeAfter, deletedAt)
	t.Cleanup(func() { deleteSyntheticSharedVault(t, ctx, pool, expiredVaultID) })
	now = purgeAfter
	if changed, err := repository.Restore(ctx, ownerID, expiredVaultID); err != nil || changed {
		t.Fatalf("restore at the purge deadline changed=%t err=%v; want unavailable", changed, err)
	}
}

func TestSharedVaultRecoveryRestoresLegacyRowsWithinDeadline(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.September, 30, 12, 0, 0, 0, time.UTC)
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	deletedAt := now.Add(-29 * 24 * time.Hour)
	vaultID := insertRecoveryVault(t, ctx, pool, ownerID, "DELETED", &deletedAt, nil, now)
	t.Cleanup(func() { deleteSyntheticSharedVault(t, ctx, pool, vaultID) })
	repository, err := NewSharedVaultRecoveryRepository(pool, func() time.Time { return now })
	if err != nil {
		t.Fatalf("create Shared Vault recovery repository: %v", err)
	}
	if restored, err := repository.Restore(ctx, ownerID, vaultID); err != nil || !restored {
		t.Fatalf("legacy Shared Vault restore=%t err=%v; want restored", restored, err)
	}
}

func insertRecoveryVault(
	t *testing.T,
	ctx context.Context,
	pool *pgxpool.Pool,
	ownerID string,
	lifecycle string,
	deletedAt *time.Time,
	purgeAfter *time.Time,
	now time.Time,
) string {
	t.Helper()
	vaultID := mustRecoveryID(t)
	if _, err := pool.Exec(ctx, `
		INSERT INTO vaults (id, type, lifecycle, owner_id, encrypted_name, encryption_version, deleted_at, purge_after, created_at, updated_at)
		VALUES ($1, 'SHARED', $2, $3, $4, 1, $5, $6, $7, $7)`,
		vaultID, lifecycle, ownerID, []byte("synthetic-encrypted-name"), deletedAt, purgeAfter, now); err != nil {
		t.Fatalf("insert synthetic recovery Vault: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO vault_members (vault_id, user_id, role, status, encrypted_vault_key, key_version, created_at, updated_at)
		VALUES ($1, $2, 'OWNER', 'ACTIVE', $3, 1, $4, $4)`, vaultID, ownerID, []byte("synthetic-owner-key-wrap"), now); err != nil {
		t.Fatalf("insert synthetic recovery Vault owner membership: %v", err)
	}
	return vaultID
}

func mustRecoveryID(t *testing.T) string {
	t.Helper()
	id, err := testsupport.NewSyntheticCUID()
	if err != nil {
		t.Fatalf("generate synthetic Vault ID: %v", err)
	}
	return id
}
