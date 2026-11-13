package infrastructure

import (
	"context"
	"encoding/base64"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

func TestPostgresWorkspaceBundleReaderOrdersTiedRowsAndKeepsTokensStable(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.August, 1, 2, 3, 4, 0, time.UTC)
	userID := testsupport.CreateSyntheticApplicationUser(t, pool)
	personalVaultID := "synthetic-sync-personal"
	sharedVaultIDs := []string{"synthetic-sync-shared-z", "synthetic-sync-shared-a"}
	allVaultIDs := append([]string{personalVaultID}, sharedVaultIDs...)
	accountIDs := []string{"synthetic-sync-account-z", "synthetic-sync-account-a"}

	insertSyncVault(t, ctx, pool, personalVaultID, userID, "PERSONAL", syntheticSyncCiphertext(1), now)
	for _, vaultID := range sharedVaultIDs {
		insertSyncVault(t, ctx, pool, vaultID, userID, "SHARED", syntheticSyncCiphertext(2), now)
		if _, err := pool.Exec(ctx, `
			INSERT INTO vault_members (vault_id, user_id, role, status, encrypted_vault_key, key_version, created_at, updated_at)
			VALUES ($1, $2, 'OWNER', 'ACTIVE', $3, 1, $4, $4)`, vaultID, userID, syntheticSyncCiphertext(1), now); err != nil {
			t.Fatalf("insert synthetic Shared Vault membership: %v", err)
		}
	}
	for _, accountID := range accountIDs {
		insertSyncAccount(t, ctx, pool, personalVaultID, accountID, now)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO user_crypto_profiles (
			user_id, vault_unlock_salt, wrapped_user_root_key, root_key_wrapping_version,
			encrypted_personal_vault_key, personal_vault_key_encryption_version, created_at, updated_at
		)
		VALUES ($1, $2, $3, 1, $4, 1, $5, $5)`,
		userID, []byte("synctestsalt0001"), syntheticSyncCiphertext(1), syntheticSyncCiphertext(1), now); err != nil {
		t.Fatalf("insert synthetic User Crypto Profile: %v", err)
	}
	t.Cleanup(func() {
		if _, err := pool.Exec(ctx, `DELETE FROM authenticator_accounts WHERE vault_id = ANY($1::text[])`, allVaultIDs); err != nil {
			t.Errorf("delete synthetic sync accounts: %v", err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM vault_members WHERE vault_id = ANY($1::text[])`, sharedVaultIDs); err != nil {
			t.Errorf("delete synthetic sync memberships: %v", err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM vaults WHERE id = ANY($1::text[])`, allVaultIDs); err != nil {
			t.Errorf("delete synthetic sync Vaults: %v", err)
		}
	})

	reader, err := NewPostgresWorkspaceBundleReader(pool, func() time.Time { return now })
	if err != nil {
		t.Fatalf("create workspace bundle reader: %v", err)
	}
	firstBundle, err := reader.ReadOnlineWorkspaceBundle(ctx, userID)
	if err != nil || firstBundle == nil {
		t.Fatalf("read online workspace bundle: bundle=%#v err=%v", firstBundle, err)
	}
	if got := firstBundle.PersonalVault.Accounts; len(got) != 2 || got[0].ID != accountIDs[1] || got[1].ID != accountIDs[0] {
		t.Fatalf("tied Personal Vault accounts were not ordered by ID: %#v", got)
	}
	if got := firstBundle.SharedVaults; len(got) != 2 || got[0].VaultID != sharedVaultIDs[1] || got[1].VaultID != sharedVaultIDs[0] {
		t.Fatalf("tied Shared Vault memberships were not ordered by Vault ID: %#v", got)
	}
	for range 3 {
		bundle, err := reader.ReadOnlineWorkspaceBundle(ctx, userID)
		if err != nil || bundle == nil || bundle.SynchronizationToken != firstBundle.SynchronizationToken {
			t.Fatalf("unchanged online bundle token=%v err=%v; want %q", bundle, err, firstBundle.SynchronizationToken)
		}
	}

	firstResponse, err := reader.ReadAuthorizedWorkspaceResponse(ctx, userID)
	if err != nil || firstResponse == nil {
		t.Fatalf("read authorized workspace response: response=%#v err=%v", firstResponse, err)
	}
	if got := firstResponse.SharedVaults; len(got) != 2 || got[0].VaultID != sharedVaultIDs[1] || got[1].VaultID != sharedVaultIDs[0] {
		t.Fatalf("authorized response Shared Vault order=%#v", got)
	}
	for range 3 {
		response, err := reader.ReadAuthorizedWorkspaceResponse(ctx, userID)
		if err != nil || response == nil || response.WorkspaceSynchronizationToken != firstResponse.WorkspaceSynchronizationToken ||
			response.PersonalSnapshot.SynchronizationToken != firstResponse.PersonalSnapshot.SynchronizationToken {
			t.Fatalf("unchanged authorized workspace tokens=%v err=%v; want stable values", response, err)
		}
	}
	if got := firstResponse.PersonalSnapshot.PersonalVault.Accounts; len(got) != 2 || got[0].ID != accountIDs[1] || got[1].ID != accountIDs[0] {
		t.Fatalf("authorized response tied Personal Vault account order=%#v", got)
	}
	if got := base64.StdEncoding.EncodeToString(syntheticSyncCiphertext(1)); firstBundle.PersonalVault.EncryptedName != got {
		t.Fatalf("Personal Vault encrypted name=%q; want synthetic ciphertext %q", firstBundle.PersonalVault.EncryptedName, got)
	}
}

func insertSyncVault(t *testing.T, ctx context.Context, pool *pgxpool.Pool, vaultID, ownerID, vaultType string, encryptedName []byte, now time.Time) {
	t.Helper()
	if _, err := pool.Exec(ctx, `
		INSERT INTO vaults (id, type, lifecycle, owner_id, encrypted_name, encryption_version, created_at, updated_at)
		VALUES ($1, $2, 'ACTIVE', $3, $4, 1, $5, $5)`, vaultID, vaultType, ownerID, encryptedName, now); err != nil {
		t.Fatalf("insert synthetic sync Vault: %v", err)
	}
}

func insertSyncAccount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, vaultID, accountID string, now time.Time) {
	t.Helper()
	if _, err := pool.Exec(ctx, `
		INSERT INTO authenticator_accounts (id, vault_id, encrypted_payload, encryption_version, revision, created_at, updated_at)
		VALUES ($1, $2, $3, 1, 1, $4, $4)`, accountID, vaultID, syntheticSyncCiphertext(1), now); err != nil {
		t.Fatalf("insert synthetic sync account: %v", err)
	}
}

func syntheticSyncCiphertext(version byte) []byte {
	value := make([]byte, 29)
	value[0] = version
	for index := 1; index < len(value); index++ {
		value[index] = byte(index + 20)
	}
	return value
}
