package repository

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	apiEntity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity"
	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

func TestSharedVaultAccessRepositoryReturnsOnlyCurrentMemberCiphertext(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	memberID := testsupport.CreateSyntheticApplicationUser(t, pool)
	outsiderID := testsupport.CreateSyntheticApplicationUser(t, pool)
	activeVaultID := insertAccessVault(t, ctx, pool, ownerID, "ACTIVE", []byte("synthetic-encrypted-name"), now, true)
	insertAccessMembership(t, ctx, pool, activeVaultID, ownerID, "OWNER", "ACTIVE", []byte("synthetic-owner-wrap"), 1, nil, nil, nil, now)
	insertAccessMembership(t, ctx, pool, activeVaultID, memberID, "VIEWER", "ACTIVE", []byte("synthetic-viewer-wrap"), 2, ptrAccessBool(false), nil, nil, now.Add(time.Second))
	activeAccountID := mustAccessID(t)
	if _, err := pool.Exec(ctx, `
		INSERT INTO authenticator_accounts (id, vault_id, encrypted_payload, encryption_version, revision, created_at, updated_at)
		VALUES ($1, $2, $3, 1, 3, $4, $4)`, activeAccountID, activeVaultID, []byte("synthetic-encrypted-account"), now); err != nil {
		t.Fatalf("insert synthetic active Shared Account: %v", err)
	}
	deletedAccountID := mustAccessID(t)
	if _, err := pool.Exec(ctx, `
		INSERT INTO authenticator_accounts
			(id, vault_id, encrypted_payload, encryption_version, revision, deleted_at, purge_after, created_at, updated_at)
		VALUES ($1, $2, $3, 1, 2, $4, $5, $4, $4)`, deletedAccountID, activeVaultID, []byte("synthetic-deleted-account"), now, now.Add(30*24*time.Hour)); err != nil {
		t.Fatalf("insert synthetic deleted Shared Account: %v", err)
	}
	missingKeyVaultID := insertAccessVault(t, ctx, pool, ownerID, "ACTIVE", []byte("synthetic-encrypted-name"), now.Add(2*time.Second), false)
	insertAccessMembership(t, ctx, pool, missingKeyVaultID, memberID, "VIEWER", "ACTIVE", nil, 1, nil, nil, nil, now.Add(2*time.Second))
	inactiveVaultID := insertAccessVault(t, ctx, pool, ownerID, "DELETED", []byte("synthetic-encrypted-name"), now.Add(3*time.Second), false)
	insertAccessMembership(t, ctx, pool, inactiveVaultID, memberID, "VIEWER", "ACTIVE", []byte("synthetic-key-wrap"), 1, nil, nil, nil, now.Add(3*time.Second))

	vaultIDs := []string{activeVaultID, missingKeyVaultID, inactiveVaultID}
	t.Cleanup(func() {
		for _, vaultID := range vaultIDs {
			_, _ = pool.Exec(ctx, `DELETE FROM vault_audit_events WHERE vault_id = $1`, vaultID)
			_, _ = pool.Exec(ctx, `DELETE FROM authenticator_accounts WHERE vault_id = $1`, vaultID)
			_, _ = pool.Exec(ctx, `DELETE FROM vault_members WHERE vault_id = $1`, vaultID)
			_, _ = pool.Exec(ctx, `DELETE FROM vaults WHERE id = $1`, vaultID)
		}
	})

	repository, err := NewSharedVaultAccessRepository(pool)
	if err != nil {
		t.Fatalf("create Shared Vault access repository: %v", err)
	}
	vaults, err := repository.ListForMember(ctx, memberID)
	if err != nil {
		t.Fatalf("list synthetic Shared Vault access: %v", err)
	}
	if len(vaults) != 1 {
		clearSharedVaultAccesses(vaults)
		t.Fatalf("Shared Vault list returned %d records, want one eligible active membership", len(vaults))
	}
	vault := vaults[0]
	if vault.VaultID != activeVaultID || vault.Role != apiEntity.SharedVaultMemberRoleViewer ||
		vault.EncryptionVersion != 1 || vault.KeyVersion != 2 || string(vault.EncryptedName) != "synthetic-encrypted-name" ||
		string(vault.EncryptedVaultKey) != "synthetic-viewer-wrap" {
		t.Fatalf("unexpected Shared Vault access metadata: %#v", vault)
	}
	if vault.EffectiveAccountPermissions.Permissions.CanAddAccounts || vault.EffectiveAccountPermissions.Sources.CanAddAccounts != apiEntity.SharedVaultAccountPermissionSourceMember ||
		vault.EffectiveAccountPermissions.Sources.CanEditAccounts != apiEntity.SharedVaultAccountPermissionSourceVault {
		t.Fatalf("Shared Vault effective permissions were not resolved: %#v", vault.EffectiveAccountPermissions)
	}
	if len(vault.Accounts) != 1 || vault.Accounts[0].ID != activeAccountID || vault.Accounts[0].Revision != 3 ||
		string(vault.Accounts[0].EncryptedPayload) != "synthetic-encrypted-account" {
		t.Fatalf("Shared Vault access returned unexpected active accounts: %#v", vault.Accounts)
	}
	clearSharedVaultAccesses(vaults)

	detail, err := repository.GetForMember(ctx, memberID, activeVaultID)
	if err != nil || detail == nil || detail.VaultID != activeVaultID || len(detail.Accounts) != 1 {
		t.Fatalf("read active member Shared Vault detail: detail=%#v err=%v", detail, err)
	}
	clearSharedVaultAccesses([]apiService.SharedVaultAccess{*detail})
	detail, err = repository.GetForMember(ctx, outsiderID, activeVaultID)
	if err != nil || detail != nil {
		t.Fatalf("read Shared Vault for non-member: detail=%#v err=%v; want unavailable", detail, err)
	}
}

func insertAccessVault(
	t *testing.T,
	ctx context.Context,
	pool *pgxpool.Pool,
	ownerID string,
	lifecycle string,
	encryptedName []byte,
	now time.Time,
	membersCanAdd bool,
) string {
	t.Helper()
	vaultID := mustAccessID(t)
	if _, err := pool.Exec(ctx, `
		INSERT INTO vaults
			(id, type, lifecycle, owner_id, encrypted_name, encryption_version, created_at, updated_at, members_can_add_accounts)
		VALUES ($1, 'SHARED', $2, $3, $4, 1, $5, $5, $6)`,
		vaultID, lifecycle, ownerID, encryptedName, now, membersCanAdd); err != nil {
		t.Fatalf("insert synthetic Shared Vault: %v", err)
	}
	return vaultID
}

func insertAccessMembership(
	t *testing.T,
	ctx context.Context,
	pool *pgxpool.Pool,
	vaultID string,
	userID string,
	role string,
	status string,
	encryptedKey []byte,
	keyVersion int,
	canAdd, canEdit, canDelete *bool,
	now time.Time,
) {
	t.Helper()
	var keyVersionValue any
	if encryptedKey != nil {
		keyVersionValue = keyVersion
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO vault_members
			(vault_id, user_id, role, status, encrypted_vault_key, key_version, created_at, updated_at,
			 can_add_accounts_override, can_edit_accounts_override, can_delete_accounts_override)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10)`,
		vaultID, userID, role, status, encryptedKey, keyVersionValue, now,
		nullableAccessBool(canAdd), nullableAccessBool(canEdit), nullableAccessBool(canDelete)); err != nil {
		t.Fatalf("insert synthetic Shared Vault membership: %v", err)
	}
}

func nullableAccessBool(value *bool) any {
	if value == nil {
		return nil
	}
	return *value
}

func ptrAccessBool(value bool) *bool {
	return &value
}

func mustAccessID(t *testing.T) string {
	t.Helper()
	id, err := testsupport.NewSyntheticCUID()
	if err != nil {
		t.Fatalf("generate synthetic ID: %v", err)
	}
	return id
}
