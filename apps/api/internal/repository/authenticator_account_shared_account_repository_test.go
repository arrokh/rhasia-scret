package repository

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	apiEntity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity"
	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

func TestSharedAccountRepositoryAuthorizesMutationsAndAuditsAtomically(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	ownerID, memberID, vaultID := createActiveSyntheticSharedVault(t, ctx, pool, now,
		[3]bool{true, false, true}, [3]*bool{nil, ptrBool(true), ptrBool(false)})
	repository, err := NewSharedAccountRepository(pool, func() time.Time { return now })
	if err != nil {
		t.Fatalf("create Shared Account repository: %v", err)
	}

	payload := syntheticPersonalAccountEnvelope(1, 64)
	created, err := repository.Create(ctx, memberID, vaultID, payload, 1, 1)
	if err != nil || created.Status != apiService.SharedAccountMutationSuccess || created.Account == nil {
		t.Fatalf("create Shared Vault account: result=%#v err=%v", created, err)
	}
	if created.Account.Revision != 1 || created.Account.VaultID != vaultID || string(created.Account.EncryptedPayload) != string(payload) {
		t.Fatalf("unexpected Shared Account creation result: %#v", created.Account)
	}
	accountID := created.Account.ID
	created.Account.Clear()

	staleKey, err := repository.Create(ctx, memberID, vaultID, payload, 1, 2)
	if err != nil || staleKey.Status != apiService.SharedAccountMutationStaleKeyVersion {
		t.Fatalf("create with stale key version: result=%#v err=%v", staleKey, err)
	}

	updatedPayload := syntheticPersonalAccountEnvelope(1, 65)
	updated, err := repository.Update(ctx, memberID, vaultID, accountID, 1, updatedPayload, 1, 1)
	if err != nil || updated.Status != apiService.SharedAccountMutationSuccess || updated.Account == nil {
		t.Fatalf("update Shared Vault account: result=%#v err=%v", updated, err)
	}
	if updated.Account.Revision != 2 || string(updated.Account.EncryptedPayload) != string(updatedPayload) {
		t.Fatalf("Shared Account update did not replace ciphertext and advance revision: %#v", updated.Account)
	}
	updated.Account.Clear()

	staleRevision, err := repository.Update(ctx, memberID, vaultID, accountID, 1, payload, 1, 1)
	if err != nil || staleRevision.Status != apiService.SharedAccountMutationStaleRevision {
		t.Fatalf("update with stale revision: result=%#v err=%v", staleRevision, err)
	}
	deniedDelete, err := repository.Delete(ctx, memberID, vaultID, accountID, 2)
	if err != nil || deniedDelete.Status != apiService.SharedAccountMutationPermissionDenied {
		t.Fatalf("delete with explicit member deny: result=%#v err=%v", deniedDelete, err)
	}
	deleted, err := repository.Delete(ctx, ownerID, vaultID, accountID, 2)
	if err != nil || deleted.Status != apiService.SharedAccountMutationSuccess {
		t.Fatalf("owner delete despite member defaults: result=%#v err=%v", deleted, err)
	}

	var revision int32
	var deletedAt, purgeAfter time.Time
	if err := pool.QueryRow(ctx, `
		SELECT revision, deleted_at, purge_after FROM authenticator_accounts WHERE id = $1`, accountID).
		Scan(&revision, &deletedAt, &purgeAfter); err != nil {
		t.Fatalf("read soft-deleted Shared Account: %v", err)
	}
	if revision != 3 || !deletedAt.Equal(now) || !purgeAfter.Equal(now.Add(apiEntity.AccountRecoveryWindow)) {
		t.Fatalf("Shared Account soft-delete state revision=%d deletedAt=%s purgeAfter=%s", revision, deletedAt, purgeAfter)
	}

	viewerRestore, err := repository.Restore(ctx, memberID, vaultID, accountID)
	if err != nil || viewerRestore.Status != apiService.SharedAccountMutationPermissionDenied {
		t.Fatalf("viewer restore: result=%#v err=%v", viewerRestore, err)
	}
	ownerRestore, err := repository.Restore(ctx, ownerID, vaultID, accountID)
	if err != nil || ownerRestore.Status != apiService.SharedAccountMutationSuccess {
		t.Fatalf("owner restore: result=%#v err=%v", ownerRestore, err)
	}
	var restoredRevision int32
	var restoredDeletedAt, restoredPurgeAfter *time.Time
	if err := pool.QueryRow(ctx, `
		SELECT revision, deleted_at, purge_after FROM authenticator_accounts WHERE id = $1`, accountID).
		Scan(&restoredRevision, &restoredDeletedAt, &restoredPurgeAfter); err != nil {
		t.Fatalf("read restored Shared Account: %v", err)
	}
	if restoredRevision != 4 || restoredDeletedAt != nil || restoredPurgeAfter != nil {
		t.Fatalf("Shared Account restore state revision=%d deletedAt=%v purgeAfter=%v", restoredRevision, restoredDeletedAt, restoredPurgeAfter)
	}

	rows, err := pool.Query(ctx, `
		SELECT event_type, owner_id, actor_user_id, target_id
		FROM vault_audit_events WHERE vault_id = $1`, vaultID)
	if err != nil {
		t.Fatalf("read Shared Account audit history: %v", err)
	}
	defer rows.Close()
	type auditRecord struct{ event, owner, actor, target string }
	events := make(map[string]auditRecord, 4)
	for rows.Next() {
		var event auditRecord
		if err := rows.Scan(&event.event, &event.owner, &event.actor, &event.target); err != nil {
			t.Fatalf("scan Shared Account audit event: %v", err)
		}
		if _, exists := events[event.event]; exists {
			t.Fatalf("duplicate Shared Account audit event %q", event.event)
		}
		events[event.event] = event
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate Shared Account audit history: %v", err)
	}
	wantEvents := []auditRecord{
		{event: "ACCOUNT_ADDED", owner: ownerID, actor: memberID, target: accountID},
		{event: "ACCOUNT_UPDATED", owner: ownerID, actor: memberID, target: accountID},
		{event: "ACCOUNT_DELETED", owner: ownerID, actor: ownerID, target: accountID},
		{event: "ACCOUNT_RESTORED", owner: ownerID, actor: ownerID, target: accountID},
	}
	if len(events) != len(wantEvents) {
		t.Fatalf("Shared Account audit events=%#v; want %#v", events, wantEvents)
	}
	for _, want := range wantEvents {
		if got := events[want.event]; got != want {
			t.Fatalf("Shared Account audit event %q=%#v; want %#v", want.event, got, want)
		}
	}
}

func TestSharedAccountRepositoryRejectsCreateWithoutAddPermission(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	tests := []struct {
		name     string
		defaults [3]bool
		override *bool
	}{
		{name: "inherited false Vault default", defaults: [3]bool{false, false, true}},
		{name: "explicit false member override over true default", defaults: [3]bool{true, false, true}, override: ptrBool(false)},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			overrides := [3]*bool{test.override, nil, nil}
			ownerID, memberID, vaultID := createActiveSyntheticSharedVault(t, ctx, pool, now, test.defaults, overrides)
			repository, err := NewSharedAccountRepository(pool, func() time.Time { return now })
			if err != nil {
				t.Fatalf("create Shared Account repository: %v", err)
			}

			payload := syntheticPersonalAccountEnvelope(1, 64)
			denied, err := repository.Create(ctx, memberID, vaultID, payload, 1, 1)
			if err != nil || denied.Status != apiService.SharedAccountMutationPermissionDenied || denied.Account != nil {
				t.Fatalf("viewer account creation without permission=%#v err=%v; want permission denied", denied, err)
			}
			var accountCount, addAuditCount int
			if err := pool.QueryRow(ctx, `SELECT count(*) FROM authenticator_accounts WHERE vault_id = $1`, vaultID).Scan(&accountCount); err != nil || accountCount != 0 {
				t.Fatalf("denied Viewer account count=%d err=%v; want no persisted account", accountCount, err)
			}
			if err := pool.QueryRow(ctx, `SELECT count(*) FROM vault_audit_events WHERE vault_id = $1 AND event_type = 'ACCOUNT_ADDED'`, vaultID).Scan(&addAuditCount); err != nil || addAuditCount != 0 {
				t.Fatalf("denied Viewer ACCOUNT_ADDED audit count=%d err=%v; want no audit event", addAuditCount, err)
			}

			ownerCreate, err := repository.Create(ctx, ownerID, vaultID, payload, 1, 1)
			if err != nil || ownerCreate.Status != apiService.SharedAccountMutationSuccess || ownerCreate.Account == nil {
				t.Fatalf("Owner account creation control=%#v err=%v; want success", ownerCreate, err)
			}
			ownerCreate.Account.Clear()
			if err := pool.QueryRow(ctx, `SELECT count(*) FROM authenticator_accounts WHERE vault_id = $1`, vaultID).Scan(&accountCount); err != nil || accountCount != 1 {
				t.Fatalf("Owner control account count=%d err=%v; want one persisted account", accountCount, err)
			}
			if err := pool.QueryRow(ctx, `SELECT count(*) FROM vault_audit_events WHERE vault_id = $1 AND event_type = 'ACCOUNT_ADDED'`, vaultID).Scan(&addAuditCount); err != nil || addAuditCount != 1 {
				t.Fatalf("Owner control ACCOUNT_ADDED audit count=%d err=%v; want one event", addAuditCount, err)
			}
		})
	}
}

func TestSharedAccountRepositoryMigratesForActiveMemberAndReplays(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	ownerID, memberID, vaultID := createActiveSyntheticSharedVault(t, ctx, pool, now,
		[3]bool{false, false, false}, [3]*bool{nil, nil, nil})
	if _, err := pool.Exec(ctx, `UPDATE vault_members SET key_version = 2 WHERE vault_id = $1`, vaultID); err != nil {
		t.Fatalf("set synthetic Shared Vault key version: %v", err)
	}
	repository, err := NewSharedAccountRepository(pool, func() time.Time { return now })
	if err != nil {
		t.Fatalf("create Shared Account repository: %v", err)
	}
	source := syntheticPersonalAccountEnvelope(1, 64)
	created, err := repository.Create(ctx, ownerID, vaultID, source, 1, 2)
	if err != nil || created.Status != apiService.SharedAccountMutationSuccess || created.Account == nil {
		t.Fatalf("create Shared Vault migration source: result=%#v err=%v", created, err)
	}
	defer created.Account.Clear()
	replacement := syntheticPersonalAccountEnvelope(2, 65)
	migration := userEncryptedPayloadMigration(source, replacement, sharedapp.SHA256Base64URL(replacement))

	result, err := repository.MigratePayload(ctx, memberID, vaultID, created.Account.ID, 1, 2, migration)
	if err != nil || result != sharedapp.EncryptedPayloadMigrationCommitted {
		t.Fatalf("migrate Shared Account as active read-only member: result=%q err=%v", result, err)
	}
	result, err = repository.MigratePayload(ctx, memberID, vaultID, created.Account.ID, 1, 2, migration)
	if err != nil || result != sharedapp.EncryptedPayloadMigrationAlreadyCommitted {
		t.Fatalf("replay Shared Account migration: result=%q err=%v", result, err)
	}
	result, err = repository.MigratePayload(ctx, memberID, vaultID, created.Account.ID, 1, 1, migration)
	if err != nil || result != sharedapp.EncryptedPayloadMigrationConflict {
		t.Fatalf("migration with stale key version: result=%q err=%v", result, err)
	}
	invalidMigration := migration
	invalidMigration.OperationID = "synthetic-invalid-operation-id"
	result, err = repository.MigratePayload(ctx, memberID, vaultID, created.Account.ID, 1, 2, invalidMigration)
	if err != nil || result != sharedapp.EncryptedPayloadMigrationConflict {
		t.Fatalf("migration with mismatched operation ID: result=%q err=%v", result, err)
	}

	var stored []byte
	var revision int32
	if err := pool.QueryRow(ctx, `SELECT encrypted_payload, revision FROM authenticator_accounts WHERE id = $1`, created.Account.ID).Scan(&stored, &revision); err != nil {
		t.Fatalf("read migrated Shared Account: %v", err)
	}
	defer clear(stored)
	if revision != 1 || string(stored) != string(replacement) {
		t.Fatalf("Shared Account migration state revision=%d ciphertext mismatch", revision)
	}
	var auditCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM vault_audit_events WHERE vault_id = $1`, vaultID).Scan(&auditCount); err != nil || auditCount != 1 {
		t.Fatalf("migration unexpectedly changed audit history: count=%d err=%v", auditCount, err)
	}
}

func TestSharedAccountRepositoryAllowsOnlyOneConcurrentRevisionUpdate(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	ownerID, memberID, vaultID := createActiveSyntheticSharedVault(t, ctx, pool, now,
		[3]bool{true, true, true}, [3]*bool{nil, nil, nil})
	repository, err := NewSharedAccountRepository(pool, func() time.Time { return now })
	if err != nil {
		t.Fatalf("create Shared Account repository: %v", err)
	}
	payload := syntheticPersonalAccountEnvelope(1, 64)
	created, err := repository.Create(ctx, ownerID, vaultID, payload, 1, 1)
	if err != nil || created.Status != apiService.SharedAccountMutationSuccess || created.Account == nil {
		t.Fatalf("create concurrent-update Shared Account: result=%#v err=%v", created, err)
	}
	defer created.Account.Clear()
	results := make(chan apiService.SharedAccountMutationResult, 2)
	errors := make(chan error, 2)
	var workers sync.WaitGroup
	workers.Add(2)
	for index := range 2 {
		go func(index int) {
			defer workers.Done()
			replacement := syntheticPersonalAccountEnvelope(1, 65+index)
			result, err := repository.Update(ctx, memberID, vaultID, created.Account.ID, 1, replacement, 1, 1)
			clear(replacement)
			results <- result
			errors <- err
		}(index)
	}
	workers.Wait()
	close(results)
	close(errors)
	successCount, staleCount := 0, 0
	for result := range results {
		if result.Status == apiService.SharedAccountMutationSuccess {
			successCount++
			if result.Account == nil || result.Account.Revision != 2 {
				t.Fatalf("concurrent Shared Account update returned invalid success: %#v", result)
			}
			result.Account.Clear()
			continue
		}
		if result.Status == apiService.SharedAccountMutationStaleRevision {
			staleCount++
			continue
		}
		t.Fatalf("unexpected concurrent Shared Account update result: %#v", result)
	}
	for err := range errors {
		if err != nil {
			t.Fatalf("concurrent Shared Account update: %v", err)
		}
	}
	if successCount != 1 || staleCount != 1 {
		t.Fatalf("concurrent update outcomes: success=%d stale=%d; want one each", successCount, staleCount)
	}
	var updateAuditCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM vault_audit_events WHERE vault_id = $1 AND event_type = 'ACCOUNT_UPDATED'`, vaultID).Scan(&updateAuditCount); err != nil || updateAuditCount != 1 {
		t.Fatalf("concurrent update audit count=%d err=%v; want exactly one", updateAuditCount, err)
	}
}

func createActiveSyntheticSharedVault(
	t *testing.T,
	ctx context.Context,
	pool *pgxpool.Pool,
	now time.Time,
	defaults [3]bool,
	overrides [3]*bool,
) (string, string, string) {
	t.Helper()
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	memberID := testsupport.CreateSyntheticApplicationUser(t, pool)
	vaultID, err := testsupport.NewSyntheticCUID()
	if err != nil {
		t.Fatalf("generate synthetic Shared Vault ID: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO vaults
			(id, type, lifecycle, owner_id, encrypted_name, encryption_version, created_at, updated_at,
			 members_can_add_accounts, members_can_edit_accounts, members_can_delete_accounts)
		VALUES ($1, 'SHARED', 'ACTIVE', $2, $3, 1, $4, $4, $5, $6, $7)`,
		vaultID, ownerID, []byte("synthetic-encrypted-vault-name"), now, defaults[0], defaults[1], defaults[2]); err != nil {
		t.Fatalf("insert synthetic Shared Vault: %v", err)
	}
	insertSyntheticSharedMembership(t, ctx, pool, vaultID, ownerID, "OWNER", 1, [3]*bool{nil, nil, nil}, now)
	insertSyntheticSharedMembership(t, ctx, pool, vaultID, memberID, "VIEWER", 1, overrides, now)
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM vault_audit_events WHERE vault_id = $1`, vaultID)
		_, _ = pool.Exec(ctx, `DELETE FROM authenticator_accounts WHERE vault_id = $1`, vaultID)
		_, _ = pool.Exec(ctx, `DELETE FROM vault_invitations WHERE vault_id = $1`, vaultID)
		_, _ = pool.Exec(ctx, `DELETE FROM vault_members WHERE vault_id = $1`, vaultID)
		_, _ = pool.Exec(ctx, `DELETE FROM vaults WHERE id = $1`, vaultID)
	})
	return ownerID, memberID, vaultID
}

func insertSyntheticSharedMembership(
	t *testing.T,
	ctx context.Context,
	pool *pgxpool.Pool,
	vaultID string,
	userID string,
	role string,
	keyVersion int,
	overrides [3]*bool,
	now time.Time,
) {
	t.Helper()
	if _, err := pool.Exec(ctx, `
		INSERT INTO vault_members
			(vault_id, user_id, role, status, encrypted_vault_key, key_version, created_at, updated_at,
			 can_add_accounts_override, can_edit_accounts_override, can_delete_accounts_override)
		VALUES ($1, $2, $3, 'ACTIVE', $4, $5, $6, $6, $7, $8, $9)`,
		vaultID, userID, role, []byte("synthetic-encrypted-key-wrap"), keyVersion, now,
		nullableBoolValue(overrides[0]), nullableBoolValue(overrides[1]), nullableBoolValue(overrides[2])); err != nil {
		t.Fatalf("insert synthetic Shared Vault membership: %v", err)
	}
}

func nullableBoolValue(value *bool) any {
	if value == nil {
		return nil
	}
	return *value
}

func ptrBool(value bool) *bool {
	return &value
}
