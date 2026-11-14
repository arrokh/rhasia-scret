package repository

import (
	"context"
	"testing"
	"time"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

func TestArchiveExportAuditRequiresActiveVaultOwner(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	otherUserID := testsupport.CreateSyntheticApplicationUser(t, pool)
	vaultID, err := testsupport.NewSyntheticCUID()
	if err != nil {
		t.Fatalf("generate synthetic Vault ID: %v", err)
	}
	now := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	if _, err := pool.Exec(ctx, `
		INSERT INTO vaults (id, type, lifecycle, owner_id, encryption_version, created_at, updated_at)
		VALUES ($1, 'PERSONAL', 'ACTIVE', $2, 1, $3, $3)`, vaultID, ownerID, now); err != nil {
		t.Fatalf("insert synthetic active vault: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM vault_audit_events WHERE vault_id = $1`, vaultID)
		_, _ = pool.Exec(ctx, `DELETE FROM vaults WHERE id = $1`, vaultID)
	})

	recorded, err := RecordArchiveExport(ctx, pool, ownerID, vaultID)
	if err != nil || !recorded {
		t.Fatalf("record owner archive export: recorded=%t err=%v", recorded, err)
	}
	var eventCount int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM vault_audit_events WHERE vault_id = $1 AND event_type = 'ARCHIVE_EXPORTED'`, vaultID).Scan(&eventCount); err != nil {
		t.Fatalf("count archive export audit events: %v", err)
	}
	if eventCount != 1 {
		t.Fatalf("archive export audit events=%d; want 1", eventCount)
	}

	recorded, err = RecordArchiveExport(ctx, pool, otherUserID, vaultID)
	if err != nil || recorded {
		t.Fatalf("non-owner archive export audit: recorded=%t err=%v; want false without error", recorded, err)
	}
	if _, err := pool.Exec(ctx, `UPDATE vaults SET lifecycle = 'DELETED', deleted_at = $2 WHERE id = $1`, vaultID, now); err != nil {
		t.Fatalf("mark synthetic vault deleted: %v", err)
	}
	recorded, err = RecordArchiveExport(ctx, pool, ownerID, vaultID)
	if err != nil || recorded {
		t.Fatalf("deleted-vault archive export audit: recorded=%t err=%v; want false without error", recorded, err)
	}
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM vault_audit_events WHERE vault_id = $1 AND event_type = 'ARCHIVE_EXPORTED'`, vaultID).Scan(&eventCount); err != nil {
		t.Fatalf("recount archive export audit events: %v", err)
	}
	if eventCount != 1 {
		t.Fatalf("unauthorized archive export added audit events=%d; want 1", eventCount)
	}
}
