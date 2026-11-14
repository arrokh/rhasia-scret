package infrastructure

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	auditentity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity/audit"
	auditapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/audit"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

func TestPostgresVaultAuditRepositoryAuthorizesAndRedactsEvents(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.April, 5, 6, 7, 8, 0, time.UTC)
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	viewerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	outsiderID := testsupport.CreateSyntheticApplicationUser(t, pool)
	vaultID := mustAuditID(t)
	accountID := mustAuditID(t)
	deletedAccountID := mustAuditID(t)
	insertAuditVault(t, ctx, pool, vaultID, ownerID, "SHARED", now)
	insertAuditMember(t, ctx, pool, vaultID, ownerID, "OWNER", now)
	insertAuditMember(t, ctx, pool, vaultID, viewerID, "VIEWER", now)
	insertAuditAccount(t, ctx, pool, vaultID, accountID, nil, now)
	deletedAt := now.Add(-time.Hour)
	purgeAfter := now.Add(29 * 24 * time.Hour)
	insertAuditAccount(t, ctx, pool, vaultID, deletedAccountID, &deletedAt, now)
	if _, err := pool.Exec(ctx, `UPDATE authenticator_accounts SET purge_after = $2 WHERE id = $1`, deletedAccountID, purgeAfter); err != nil {
		t.Fatalf("set synthetic deleted account recovery deadline: %v", err)
	}
	t.Cleanup(func() { cleanupAuditVault(t, ctx, pool, vaultID) })
	repository, err := NewPostgresVaultAuditRepository(pool, func() time.Time { return now })
	if err != nil {
		t.Fatalf("create Vault audit repository: %v", err)
	}
	if recorded, err := repository.RecordAccountAccess(ctx, viewerID, vaultID, accountID); err != nil || !recorded {
		t.Fatalf("active Viewer account-access audit recorded=%t err=%v", recorded, err)
	}
	if recorded, err := repository.RecordAccountAccess(ctx, outsiderID, vaultID, accountID); err != nil || recorded {
		t.Fatalf("outsider account-access audit recorded=%t err=%v; want denied", recorded, err)
	}
	if recorded, err := repository.RecordAccountAccess(ctx, viewerID, vaultID, deletedAccountID); err != nil || recorded {
		t.Fatalf("deleted account-access audit recorded=%t err=%v; want denied", recorded, err)
	}
	if page, err := repository.ListForOwner(ctx, viewerID, vaultID, auditapp.VaultAuditFilter{}, sharedapp.CursorPageRequest{Limit: 20}); err != nil || page != nil {
		t.Fatalf("Viewer could list owner audit: page=%#v err=%v", page, err)
	}
	page, err := repository.ListForOwner(ctx, ownerID, vaultID, auditapp.VaultAuditFilter{}, sharedapp.CursorPageRequest{Limit: 20})
	if err != nil || page == nil || len(page.Items) != 1 || page.Items[0].EventType != string(auditentity.ActionAccountAccessed) ||
		page.Items[0].TargetID == nil || *page.Items[0].TargetID != accountID || page.Items[0].ActorUserID != viewerID ||
		page.Items[0].ActorEmail != fmt.Sprintf("integration-%s@example.test", viewerID) {
		t.Fatalf("owner audit page=%#v err=%v; want redacted Viewer account access", page, err)
	}
	filtered, err := repository.ListForOwner(ctx, ownerID, vaultID, auditapp.VaultAuditFilter{AccountID: &deletedAccountID}, sharedapp.CursorPageRequest{Limit: 20})
	if err != nil || filtered == nil || len(filtered.Items) != 0 {
		t.Fatalf("filtered owner audit=%#v err=%v; want empty page", filtered, err)
	}

	tiedAt := now.Add(24 * time.Hour)
	firstID := "audit-z-" + mustAuditID(t)
	secondID := "audit-a-" + mustAuditID(t)
	insertAuditEvent(t, ctx, pool, firstID, vaultID, ownerID, viewerID, "ACCOUNT_ACCESSED", "tie-target", tiedAt, nil)
	insertAuditEvent(t, ctx, pool, secondID, vaultID, ownerID, viewerID, "ACCOUNT_ACCESSED", "tie-target", tiedAt, nil)
	insertAuditEvent(t, ctx, pool, "audit-unknown-"+mustAuditID(t), vaultID, ownerID, outsiderID, "SYNTHETIC_FUTURE_ACTION", "", tiedAt.Add(time.Hour), nil)
	tieFilter := "tie-target"
	firstPage, err := repository.ListForOwner(ctx, ownerID, vaultID, auditapp.VaultAuditFilter{AccountID: &tieFilter}, sharedapp.CursorPageRequest{Limit: 1})
	if err != nil || firstPage == nil || len(firstPage.Items) != 1 || firstPage.Items[0].ID != firstID || firstPage.NextCursor == nil {
		t.Fatalf("first tie-break page=%#v err=%v; want greatest ID and cursor", firstPage, err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM vault_audit_events WHERE id = $1`, firstID); err != nil {
		t.Fatalf("delete synthetic first-page audit event: %v", err)
	}
	secondPage, err := repository.ListForOwner(ctx, ownerID, vaultID, auditapp.VaultAuditFilter{AccountID: &tieFilter}, sharedapp.CursorPageRequest{Cursor: firstPage.NextCursor, Limit: 1})
	if err != nil || secondPage == nil || len(secondPage.Items) != 1 || secondPage.Items[0].ID != secondID || secondPage.NextCursor != nil {
		t.Fatalf("second tie-break page=%#v err=%v; want remaining tied event", secondPage, err)
	}
	allEvents, err := repository.ListForOwner(ctx, ownerID, vaultID, auditapp.VaultAuditFilter{}, sharedapp.CursorPageRequest{Limit: 20})
	if err != nil || allEvents == nil || !containsAuditAction(allEvents.Items, string(auditentity.UnknownSecurityActivity)) {
		t.Fatalf("unknown audit event was not redacted: page=%#v err=%v", allEvents, err)
	}
}

func TestPostgresVaultAuditRepositoryRecordsPersonalCopyAndArchiveExport(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.May, 6, 7, 8, 9, 0, time.UTC)
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	outsiderID := testsupport.CreateSyntheticApplicationUser(t, pool)
	vaultID := mustAuditID(t)
	firstAccountID := mustAuditID(t)
	secondAccountID := mustAuditID(t)
	insertAuditVault(t, ctx, pool, vaultID, ownerID, "PERSONAL", now)
	insertAuditAccount(t, ctx, pool, vaultID, firstAccountID, nil, now)
	insertAuditAccount(t, ctx, pool, vaultID, secondAccountID, nil, now)
	t.Cleanup(func() { cleanupAuditVault(t, ctx, pool, vaultID) })
	repository, err := NewPostgresVaultAuditRepository(pool, func() time.Time { return now })
	if err != nil {
		t.Fatalf("create Vault audit repository: %v", err)
	}
	if recorded, err := repository.RecordPersonalAccountCopiesToLocal(ctx, ownerID, vaultID, []string{firstAccountID, secondAccountID}); err != nil || !recorded {
		t.Fatalf("record Personal Vault copy events=%t err=%v", recorded, err)
	}
	if recorded, err := repository.RecordPersonalAccountCopiesToLocal(ctx, outsiderID, vaultID, []string{firstAccountID}); err != nil || recorded {
		t.Fatalf("outsider Personal Vault copy events=%t err=%v; want denied", recorded, err)
	}
	if recorded, err := repository.RecordPersonalAccountCopiesToLocal(ctx, ownerID, vaultID, []string{firstAccountID, firstAccountID}); err != nil || recorded {
		t.Fatalf("duplicate Personal Vault copy events=%t err=%v; want rejected", recorded, err)
	}
	if recorded, err := repository.RecordPersonalAccountCopiesToLocal(ctx, ownerID, vaultID, []string{firstAccountID, "synthetic-missing-account"}); err != nil || recorded {
		t.Fatalf("partial Personal Vault copy events=%t err=%v; want atomic rejection", recorded, err)
	}
	if recorded, err := repository.RecordArchiveExport(ctx, ownerID, vaultID); err != nil || !recorded {
		t.Fatalf("record owner archive export=%t err=%v", recorded, err)
	}
	if recorded, err := repository.RecordArchiveExport(ctx, outsiderID, vaultID); err != nil || recorded {
		t.Fatalf("record outsider archive export=%t err=%v; want denied", recorded, err)
	}
	page, err := repository.ListForOwner(ctx, ownerID, vaultID, auditapp.VaultAuditFilter{}, sharedapp.CursorPageRequest{Limit: 20})
	if err != nil || page == nil || len(page.Items) != 3 || !containsAuditAction(page.Items, string(auditentity.ActionAccountCopiedToLocal)) ||
		!containsAuditAction(page.Items, string(auditentity.ActionArchiveExported)) {
		t.Fatalf("Personal Vault audit page=%#v err=%v", page, err)
	}
}

func TestPostgresVaultAuditRepositoryRetainsDeletedAndPurgedVaultEventsForOwner(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	deletedAt := time.Date(2026, time.June, 7, 8, 9, 10, 0, time.UTC)
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	vaultID := mustAuditID(t)
	insertAuditVault(t, ctx, pool, vaultID, ownerID, "SHARED", deletedAt)
	t.Cleanup(func() { cleanupAuditVault(t, ctx, pool, vaultID) })
	eventID := "audit-retained-" + mustAuditID(t)
	insertAuditEvent(t, ctx, pool, eventID, vaultID, ownerID, ownerID, "ACCOUNT_ACCESSED", "synthetic-account", deletedAt.Add(-time.Hour), nil)
	deadline := auditentity.AuditPurgeAfter(deletedAt)
	if _, err := pool.Exec(ctx, `
		UPDATE vaults SET lifecycle = 'DELETED', deleted_at = $2, purge_after = $3 WHERE id = $1`, vaultID, deletedAt, deletedAt.Add(30*24*time.Hour)); err != nil {
		t.Fatalf("mark synthetic Vault deleted: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE vault_audit_events SET retention_purge_after = $2 WHERE id = $1`, eventID, deadline); err != nil {
		t.Fatalf("set synthetic Vault audit retention: %v", err)
	}
	repository, err := NewPostgresVaultAuditRepository(pool, func() time.Time { return deletedAt.Add(24 * time.Hour) })
	if err != nil {
		t.Fatalf("create retained Vault audit repository: %v", err)
	}
	page, err := repository.ListForOwner(ctx, ownerID, vaultID, auditapp.VaultAuditFilter{}, sharedapp.CursorPageRequest{Limit: 20})
	if err != nil || page == nil || len(page.Items) != 1 || page.Items[0].ID != eventID {
		t.Fatalf("deleted Vault audit page=%#v err=%v; want retained owner event", page, err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM vault_members WHERE vault_id = $1`, vaultID); err != nil {
		t.Fatalf("remove synthetic members before Vault purge: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM vaults WHERE id = $1`, vaultID); err != nil {
		t.Fatalf("purge synthetic deleted Vault: %v", err)
	}
	repository, err = NewPostgresVaultAuditRepository(pool, func() time.Time { return deletedAt.Add(2 * 24 * time.Hour) })
	if err != nil {
		t.Fatalf("create purged Vault audit repository: %v", err)
	}
	page, err = repository.ListForOwner(ctx, ownerID, vaultID, auditapp.VaultAuditFilter{}, sharedapp.CursorPageRequest{Limit: 20})
	if err != nil || page == nil || len(page.Items) != 1 || page.Items[0].ID != eventID {
		t.Fatalf("purged Vault retained audit page=%#v err=%v", page, err)
	}
	repository, err = NewPostgresVaultAuditRepository(pool, func() time.Time { return deadline })
	if err != nil {
		t.Fatalf("create expired Vault audit repository: %v", err)
	}
	page, err = repository.ListForOwner(ctx, ownerID, vaultID, auditapp.VaultAuditFilter{}, sharedapp.CursorPageRequest{Limit: 20})
	if err != nil || page != nil {
		t.Fatalf("expired purged Vault audit page=%#v err=%v; want inaccessible", page, err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM vault_audit_events WHERE vault_id = $1`, vaultID); err != nil {
		t.Fatalf("delete synthetic retained Vault audit events: %v", err)
	}
}

func insertAuditVault(t *testing.T, ctx context.Context, pool *pgxpool.Pool, vaultID, ownerID, vaultType string, now time.Time) {
	t.Helper()
	if _, err := pool.Exec(ctx, `
		INSERT INTO vaults (id, type, lifecycle, owner_id, encrypted_name, encryption_version, created_at, updated_at)
		VALUES ($1, $2, 'ACTIVE', $3, $4, 1, $5, $5)`, vaultID, vaultType, ownerID, []byte("synthetic-encrypted-vault-name"), now); err != nil {
		t.Fatalf("insert synthetic audit Vault: %v", err)
	}
}

func insertAuditMember(t *testing.T, ctx context.Context, pool *pgxpool.Pool, vaultID, userID, role string, now time.Time) {
	t.Helper()
	if _, err := pool.Exec(ctx, `
		INSERT INTO vault_members (vault_id, user_id, role, status, encrypted_vault_key, key_version, created_at, updated_at)
		VALUES ($1, $2, $3, 'ACTIVE', $4, 1, $5, $5)`, vaultID, userID, role, []byte("synthetic-encrypted-vault-key-wrap"), now); err != nil {
		t.Fatalf("insert synthetic audit Vault member: %v", err)
	}
}

func insertAuditAccount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, vaultID, accountID string, deletedAt *time.Time, now time.Time) {
	t.Helper()
	if _, err := pool.Exec(ctx, `
		INSERT INTO authenticator_accounts (id, vault_id, encrypted_payload, encryption_version, revision, deleted_at, created_at, updated_at)
		VALUES ($1, $2, $3, 1, 1, $4, $5, $5)`, accountID, vaultID, []byte("synthetic-encrypted-account-payload"), deletedAt, now); err != nil {
		t.Fatalf("insert synthetic audit account: %v", err)
	}
}

func insertAuditEvent(
	t *testing.T,
	ctx context.Context,
	pool *pgxpool.Pool,
	id, vaultID, ownerID, actorID, eventType string,
	targetID string,
	createdAt time.Time,
	retentionPurgeAfter *time.Time,
) {
	t.Helper()
	var target any
	if targetID != "" {
		target = targetID
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO vault_audit_events (id, vault_id, owner_id, actor_user_id, event_type, target_id, created_at, retention_purge_after)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, id, vaultID, ownerID, actorID, eventType, target, createdAt, retentionPurgeAfter); err != nil {
		t.Fatalf("insert synthetic Vault audit event: %v", err)
	}
}

func cleanupAuditVault(t *testing.T, ctx context.Context, pool *pgxpool.Pool, vaultID string) {
	t.Helper()
	if _, err := pool.Exec(ctx, `DELETE FROM vault_audit_events WHERE vault_id = $1`, vaultID); err != nil {
		t.Errorf("delete synthetic Vault audit events: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM authenticator_accounts WHERE vault_id = $1`, vaultID); err != nil {
		t.Errorf("delete synthetic audit accounts: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM vault_invitations WHERE vault_id = $1`, vaultID); err != nil {
		t.Errorf("delete synthetic audit invitations: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM vault_members WHERE vault_id = $1`, vaultID); err != nil {
		t.Errorf("delete synthetic audit members: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM vaults WHERE id = $1`, vaultID); err != nil {
		t.Errorf("delete synthetic audit Vault: %v", err)
	}
}

func mustAuditID(t *testing.T) string {
	t.Helper()
	id, err := testsupport.NewSyntheticCUID()
	if err != nil {
		t.Fatalf("generate synthetic audit record ID: %v", err)
	}
	return id
}

func containsAuditAction(events []auditapp.RedactedVaultAuditEvent, action string) bool {
	for _, event := range events {
		if event.EventType == action {
			return true
		}
	}
	return false
}
