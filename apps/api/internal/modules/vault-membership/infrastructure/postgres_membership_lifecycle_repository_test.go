package infrastructure

import (
	"context"
	"errors"
	"testing"
	"time"

	membershipapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-membership/application"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

func TestPostgresMembershipLifecycleRevokesAndLeavesWithoutDeletingKeyWrap(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.August, 9, 10, 11, 12, 0, time.UTC)
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	viewerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	outsiderID := testsupport.CreateSyntheticApplicationUser(t, pool)
	vaultID := insertAccessVault(t, ctx, pool, ownerID, "ACTIVE", []byte("synthetic-vault-name"), now, true)
	insertAccessMembership(t, ctx, pool, vaultID, ownerID, "OWNER", "ACTIVE", []byte("synthetic-owner-wrap"), 1, nil, nil, nil, now)
	viewerWrap := []byte("synthetic-viewer-wrap")
	insertAccessMembership(t, ctx, pool, vaultID, viewerID, "VIEWER", "ACTIVE", viewerWrap, 4, ptrAccessBool(true), ptrAccessBool(false), ptrAccessBool(true), now.Add(time.Second))
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM vault_audit_events WHERE vault_id = $1`, vaultID)
		_, _ = pool.Exec(ctx, `DELETE FROM authenticator_accounts WHERE vault_id = $1`, vaultID)
		_, _ = pool.Exec(ctx, `DELETE FROM vault_members WHERE vault_id = $1`, vaultID)
		_, _ = pool.Exec(ctx, `DELETE FROM vaults WHERE id = $1`, vaultID)
	})
	repository, err := NewPostgresMembershipLifecycleRepository(pool, func() time.Time { return now })
	if err != nil {
		t.Fatalf("create membership lifecycle repository: %v", err)
	}
	if err := repository.Revoke(ctx, ownerID, vaultID, viewerID); err != nil {
		t.Fatalf("revoke active Viewer membership: %v", err)
	}
	var status string
	var revokedAt *time.Time
	var encryptedKey []byte
	var keyVersion *int32
	var canAdd, canEdit, canDelete *bool
	var revision int32
	if err := pool.QueryRow(ctx, `
		SELECT status, revoked_at, encrypted_vault_key, key_version, can_add_accounts_override,
		       can_edit_accounts_override, can_delete_accounts_override, permissions_revision
		FROM vault_members WHERE vault_id = $1 AND user_id = $2`, vaultID, viewerID).Scan(
		&status, &revokedAt, &encryptedKey, &keyVersion, &canAdd, &canEdit, &canDelete, &revision,
	); err != nil {
		t.Fatalf("read revoked Viewer membership: %v", err)
	}
	if status != "REVOKED" || revokedAt == nil || !revokedAt.Equal(now) || string(encryptedKey) != string(viewerWrap) ||
		keyVersion == nil || *keyVersion != 4 || canAdd != nil || canEdit != nil || canDelete != nil || revision != 2 {
		t.Fatalf("revoked membership state=%q key=%q keyVersion=%v overrides=(%v,%v,%v) revision=%d revokedAt=%v", status, encryptedKey, keyVersion, canAdd, canEdit, canDelete, revision, revokedAt)
	}
	if err := repository.Revoke(ctx, ownerID, vaultID, viewerID); !errors.Is(err, membershipapp.ErrMembershipUnavailable) {
		t.Fatalf("repeat revocation error=%v; want unavailable", err)
	}
	if err := repository.Revoke(ctx, ownerID, vaultID, ownerID); !errors.Is(err, membershipapp.ErrMembershipUnavailable) {
		t.Fatalf("owner self-revocation error=%v; want unavailable", err)
	}
	if err := repository.Revoke(ctx, outsiderID, vaultID, viewerID); !errors.Is(err, membershipapp.ErrMembershipUnavailable) {
		t.Fatalf("non-owner revocation error=%v; want unavailable", err)
	}

	leaveVaultID := insertAccessVault(t, ctx, pool, ownerID, "ACTIVE", []byte("synthetic-vault-name"), now.Add(2*time.Second), false)
	insertAccessMembership(t, ctx, pool, leaveVaultID, ownerID, "OWNER", "ACTIVE", []byte("synthetic-owner-wrap"), 1, nil, nil, nil, now.Add(2*time.Second))
	leaveWrap := []byte("synthetic-leave-key-wrap")
	insertAccessMembership(t, ctx, pool, leaveVaultID, viewerID, "VIEWER", "ACTIVE", leaveWrap, 5, ptrAccessBool(true), ptrAccessBool(true), nil, now.Add(3*time.Second))
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM vault_audit_events WHERE vault_id = $1`, leaveVaultID)
		_, _ = pool.Exec(ctx, `DELETE FROM authenticator_accounts WHERE vault_id = $1`, leaveVaultID)
		_, _ = pool.Exec(ctx, `DELETE FROM vault_members WHERE vault_id = $1`, leaveVaultID)
		_, _ = pool.Exec(ctx, `DELETE FROM vaults WHERE id = $1`, leaveVaultID)
	})
	if err := repository.Leave(ctx, viewerID, leaveVaultID); err != nil {
		t.Fatalf("Viewer leaves Shared Vault: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		SELECT status, revoked_at, encrypted_vault_key, key_version, can_add_accounts_override,
		       can_edit_accounts_override, can_delete_accounts_override, permissions_revision
		FROM vault_members WHERE vault_id = $1 AND user_id = $2`, leaveVaultID, viewerID).Scan(
		&status, &revokedAt, &encryptedKey, &keyVersion, &canAdd, &canEdit, &canDelete, &revision,
	); err != nil {
		t.Fatalf("read Viewer leave state: %v", err)
	}
	if status != "LEFT" || revokedAt == nil || !revokedAt.Equal(now) || string(encryptedKey) != string(leaveWrap) ||
		keyVersion == nil || *keyVersion != 5 || canAdd != nil || canEdit != nil || canDelete != nil || revision != 2 {
		t.Fatalf("left membership state=%q key=%q keyVersion=%v overrides=(%v,%v,%v) revision=%d revokedAt=%v", status, encryptedKey, keyVersion, canAdd, canEdit, canDelete, revision, revokedAt)
	}
	if err := repository.Leave(ctx, ownerID, leaveVaultID); !errors.Is(err, membershipapp.ErrMembershipUnavailable) {
		t.Fatalf("owner leave error=%v; want unavailable", err)
	}
}
