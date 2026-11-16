package repository

import (
	"context"
	"testing"
	"time"

	apiEntity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity"
	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

func TestSharedVaultPermissionRepositoryAuditsOptimisticOwnerUpdates(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.June, 7, 8, 9, 10, 0, time.UTC)
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	viewerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	otherOwnerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	vaultID := insertAccessVault(t, ctx, pool, ownerID, "ACTIVE", []byte("synthetic-vault-name"), now, false)
	insertAccessMembership(t, ctx, pool, vaultID, ownerID, "OWNER", "ACTIVE", []byte("synthetic-owner-wrap"), 1, nil, nil, nil, now)
	insertAccessMembership(t, ctx, pool, vaultID, viewerID, "VIEWER", "ACTIVE", []byte("synthetic-viewer-wrap"), 1, nil, nil, nil, now.Add(time.Second))
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM vault_audit_events WHERE vault_id = $1`, vaultID)
		_, _ = pool.Exec(ctx, `DELETE FROM vault_members WHERE vault_id = $1`, vaultID)
		_, _ = pool.Exec(ctx, `DELETE FROM vaults WHERE id = $1`, vaultID)
	})
	repository, err := NewSharedVaultAccountPermissionRepository(pool, func() time.Time { return now })
	if err != nil {
		t.Fatalf("create permission repository: %v", err)
	}

	defaults, err := repository.ReadVaultDefaults(ctx, ownerID, vaultID)
	if err != nil || defaults == nil || defaults.Revision != 1 || defaults.Permissions.CanAddAccounts {
		t.Fatalf("read default permissions=%#v err=%v", defaults, err)
	}
	changedDefaults := apiEntity.SharedVaultAccountPermissions{CanAddAccounts: true, CanEditAccounts: false, CanDeleteAccounts: true}
	updatedDefaults, err := repository.UpdateVaultDefaults(ctx, ownerID, vaultID, 1, changedDefaults)
	if err != nil || updatedDefaults.Status != apiService.SharedVaultPermissionUpdateUpdated || updatedDefaults.Value.Revision != 2 || updatedDefaults.Value.Permissions != changedDefaults {
		t.Fatalf("update default permissions=%#v err=%v", updatedDefaults, err)
	}
	staleDefaults, err := repository.UpdateVaultDefaults(ctx, ownerID, vaultID, 1, apiEntity.SharedVaultAccountPermissions{})
	if err != nil || staleDefaults.Status != apiService.SharedVaultPermissionUpdateStale {
		t.Fatalf("stale default permission update=%#v err=%v", staleDefaults, err)
	}
	unavailableDefaults, err := repository.UpdateVaultDefaults(ctx, otherOwnerID, vaultID, 2, apiEntity.SharedVaultAccountPermissions{})
	if err != nil || unavailableDefaults.Status != apiService.SharedVaultPermissionUpdateUnavailable {
		t.Fatalf("unauthorized default permission update=%#v err=%v", unavailableDefaults, err)
	}

	var eventCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM vault_audit_events WHERE vault_id = $1`, vaultID).Scan(&eventCount); err != nil || eventCount != 1 {
		t.Fatalf("default permission audit count=%d err=%v; want one", eventCount, err)
	}
	var eventType, actorID string
	if err := pool.QueryRow(ctx, `SELECT event_type, actor_user_id FROM vault_audit_events WHERE vault_id = $1`, vaultID).Scan(&eventType, &actorID); err != nil ||
		eventType != "VAULT_MEMBER_DEFAULT_PERMISSIONS_UPDATED" || actorID != ownerID {
		t.Fatalf("default permission audit event=%q actor=%q err=%v", eventType, actorID, err)
	}
}

func TestSharedVaultPermissionRepositoryUpdatesViewerOverridesAndAuditsAtomically(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.July, 8, 9, 10, 11, 0, time.UTC)
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	viewerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	vaultID := insertAccessVault(t, ctx, pool, ownerID, "ACTIVE", []byte("synthetic-vault-name"), now, true)
	if _, err := pool.Exec(ctx, `UPDATE vaults SET members_can_edit_accounts = true WHERE id = $1`, vaultID); err != nil {
		t.Fatalf("set synthetic inherited edit permission: %v", err)
	}
	insertAccessMembership(t, ctx, pool, vaultID, ownerID, "OWNER", "ACTIVE", []byte("synthetic-owner-wrap"), 1, nil, nil, nil, now)
	insertAccessMembership(t, ctx, pool, vaultID, viewerID, "VIEWER", "ACTIVE", []byte("synthetic-viewer-wrap"), 1, nil, nil, nil, now.Add(time.Second))
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM vault_audit_events WHERE vault_id = $1`, vaultID)
		_, _ = pool.Exec(ctx, `DELETE FROM vault_members WHERE vault_id = $1`, vaultID)
		_, _ = pool.Exec(ctx, `DELETE FROM vaults WHERE id = $1`, vaultID)
	})
	repository, err := NewSharedVaultAccountPermissionRepository(pool, func() time.Time { return now })
	if err != nil {
		t.Fatalf("create permission repository: %v", err)
	}
	falseValue := false
	trueValue := true
	overrides := apiEntity.SharedVaultAccountPermissionOverrides{
		CanAddAccounts:    &falseValue,
		CanEditAccounts:   nil,
		CanDeleteAccounts: &trueValue,
	}
	updated, err := repository.UpdateMemberOverrides(ctx, ownerID, vaultID, viewerID, 1, overrides)
	if err != nil || updated.Status != apiService.SharedVaultPermissionUpdateUpdated || updated.Value.Revision != 2 ||
		updated.Value.Overrides.CanAddAccounts == nil || *updated.Value.Overrides.CanAddAccounts ||
		updated.Value.Overrides.CanEditAccounts != nil || updated.Value.Overrides.CanDeleteAccounts == nil || !*updated.Value.Overrides.CanDeleteAccounts {
		t.Fatalf("update member overrides=%#v err=%v", updated, err)
	}
	effective := updated.Value.Effective
	if effective.Permissions.CanAddAccounts || !effective.Permissions.CanEditAccounts || !effective.Permissions.CanDeleteAccounts ||
		effective.Sources.CanAddAccounts != apiEntity.SharedVaultAccountPermissionSourceMember ||
		effective.Sources.CanEditAccounts != apiEntity.SharedVaultAccountPermissionSourceVault ||
		effective.Sources.CanDeleteAccounts != apiEntity.SharedVaultAccountPermissionSourceMember {
		t.Fatalf("effective member permissions=%#v", effective)
	}
	stale, err := repository.UpdateMemberOverrides(ctx, ownerID, vaultID, viewerID, 1, apiEntity.SharedVaultAccountPermissionOverrides{})
	if err != nil || stale.Status != apiService.SharedVaultPermissionUpdateStale {
		t.Fatalf("stale member permission update=%#v err=%v", stale, err)
	}
	ownerUpdate, err := repository.UpdateMemberOverrides(ctx, ownerID, vaultID, ownerID, 1, apiEntity.SharedVaultAccountPermissionOverrides{})
	if err != nil || ownerUpdate.Status != apiService.SharedVaultPermissionUpdateUnavailable {
		t.Fatalf("owner override update=%#v err=%v", ownerUpdate, err)
	}
	var eventCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM vault_audit_events WHERE vault_id = $1`, vaultID).Scan(&eventCount); err != nil || eventCount != 1 {
		t.Fatalf("member permission audit count=%d err=%v; want one", eventCount, err)
	}
	var eventType, targetID, actorID string
	if err := pool.QueryRow(ctx, `SELECT event_type, target_id, actor_user_id FROM vault_audit_events WHERE vault_id = $1`, vaultID).Scan(&eventType, &targetID, &actorID); err != nil ||
		eventType != "MEMBER_PERMISSIONS_UPDATED" || targetID != viewerID || actorID != ownerID {
		t.Fatalf("member permission audit event=%q target=%q actor=%q err=%v", eventType, targetID, actorID, err)
	}
}
