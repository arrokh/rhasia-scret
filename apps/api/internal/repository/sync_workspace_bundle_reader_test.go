package repository

import (
	"context"
	"encoding/base64"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

func TestWorkspaceBundleReaderIsolatesActorsAndExcludesInactiveMemberships(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.August, 1, 2, 3, 4, 0, time.UTC)
	firstUserID := testsupport.CreateSyntheticApplicationUser(t, pool)
	secondUserID := testsupport.CreateSyntheticApplicationUser(t, pool)
	firstPersonalVaultID := "synthetic-sync-first-personal"
	secondPersonalVaultID := "synthetic-sync-second-personal"
	activeViewerSharedVaultID := "synthetic-sync-shared-active-viewer"
	revokedViewerSharedVaultID := "synthetic-sync-shared-revoked-viewer"
	firstPersonalAccountID := "synthetic-sync-first-personal-account"
	secondPersonalAccountID := "synthetic-sync-second-personal-account"
	activeViewerSharedAccountID := "synthetic-sync-active-viewer-shared-account"
	revokedViewerSharedAccountID := "synthetic-sync-revoked-viewer-shared-account"

	insertSyncVault(t, ctx, pool, firstPersonalVaultID, firstUserID, "PERSONAL", syntheticSyncCiphertextWithMarker(1, 1), now)
	insertSyncVault(t, ctx, pool, secondPersonalVaultID, secondUserID, "PERSONAL", syntheticSyncCiphertextWithMarker(1, 2), now)
	insertSyncVault(t, ctx, pool, activeViewerSharedVaultID, secondUserID, "SHARED", syntheticSyncCiphertextWithMarker(1, 3), now)
	insertSyncVault(t, ctx, pool, revokedViewerSharedVaultID, secondUserID, "SHARED", syntheticSyncCiphertextWithMarker(1, 4), now)
	insertSyncAccount(t, ctx, pool, firstPersonalVaultID, firstPersonalAccountID, syntheticSyncCiphertextWithMarker(1, 5), now)
	insertSyncAccount(t, ctx, pool, secondPersonalVaultID, secondPersonalAccountID, syntheticSyncCiphertextWithMarker(1, 6), now)
	insertSyncAccount(t, ctx, pool, activeViewerSharedVaultID, activeViewerSharedAccountID, syntheticSyncCiphertextWithMarker(1, 7), now)
	insertSyncAccount(t, ctx, pool, revokedViewerSharedVaultID, revokedViewerSharedAccountID, syntheticSyncCiphertextWithMarker(1, 8), now)
	if _, err := pool.Exec(ctx, `
		INSERT INTO vault_members (vault_id, user_id, role, status, encrypted_vault_key, key_version, created_at, updated_at)
		VALUES ($1, $2, 'OWNER', 'ACTIVE', $3, 1, $4, $4),
		       ($1, $5, 'VIEWER', 'ACTIVE', $6, 1, $4, $4),
		       ($7, $2, 'OWNER', 'ACTIVE', $8, 1, $4, $4),
		       ($7, $5, 'VIEWER', 'REVOKED', $9, 1, $4, $4)`,
		activeViewerSharedVaultID, secondUserID, syntheticSyncCiphertextWithMarker(1, 9), now, firstUserID,
		syntheticSyncCiphertextWithMarker(1, 10), revokedViewerSharedVaultID,
		syntheticSyncCiphertextWithMarker(1, 11), syntheticSyncCiphertextWithMarker(1, 12)); err != nil {
		t.Fatalf("insert synthetic owner, active Viewer, and revoked Viewer memberships: %v", err)
	}
	insertSyncCryptoProfileWithCiphertext(t, ctx, pool, firstUserID, "synctestsalt0001",
		syntheticSyncCiphertextWithMarker(1, 13), syntheticSyncCiphertextWithMarker(1, 14), now)
	insertSyncCryptoProfileWithCiphertext(t, ctx, pool, secondUserID, "synctestsalt0002",
		syntheticSyncCiphertextWithMarker(1, 15), syntheticSyncCiphertextWithMarker(1, 16), now)
	t.Cleanup(func() {
		vaultIDs := []string{firstPersonalVaultID, secondPersonalVaultID, activeViewerSharedVaultID, revokedViewerSharedVaultID}
		if _, err := pool.Exec(ctx, `DELETE FROM authenticator_accounts WHERE vault_id = ANY($1::text[])`, vaultIDs); err != nil {
			t.Errorf("delete synthetic actor-isolation sync accounts: %v", err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM vault_members WHERE vault_id = ANY($1::text[])`, vaultIDs); err != nil {
			t.Errorf("delete synthetic actor-isolation sync memberships: %v", err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM vaults WHERE id = ANY($1::text[])`, vaultIDs); err != nil {
			t.Errorf("delete synthetic actor-isolation sync Vaults: %v", err)
		}
	})

	reader, err := NewWorkspaceBundleReader(pool, func() time.Time { return now })
	if err != nil {
		t.Fatalf("create workspace bundle reader: %v", err)
	}
	firstBundle, err := reader.ReadOnlineWorkspaceBundle(ctx, firstUserID)
	if err != nil || firstBundle == nil {
		t.Fatalf("read first actor workspace bundle: bundle=%#v err=%v", firstBundle, err)
	}
	if firstBundle.ProfileID != firstUserID ||
		firstBundle.CryptoProfile.VaultUnlockSalt != base64.StdEncoding.EncodeToString([]byte("synctestsalt0001")) ||
		firstBundle.CryptoProfile.WrappedUserRootKey != encodedSyntheticSyncCiphertext(1, 13) ||
		firstBundle.CryptoProfile.EncryptedPersonalVaultKey != encodedSyntheticSyncCiphertext(1, 14) ||
		firstBundle.PersonalVault.VaultID != firstPersonalVaultID ||
		firstBundle.PersonalVault.EncryptedName != encodedSyntheticSyncCiphertext(1, 1) ||
		len(firstBundle.PersonalVault.Accounts) != 1 || firstBundle.PersonalVault.Accounts[0].ID != firstPersonalAccountID ||
		firstBundle.PersonalVault.Accounts[0].EncryptedPayload != encodedSyntheticSyncCiphertext(1, 5) ||
		len(firstBundle.SharedVaults) != 1 || firstBundle.SharedVaults[0].VaultID != activeViewerSharedVaultID {
		t.Fatalf("first actor bundle leaked unrelated Personal/shared data or excluded its active Viewer membership: %#v", firstBundle)
	}
	firstSharedVault := firstBundle.SharedVaults[0]
	if firstSharedVault.Role != "VIEWER" || firstSharedVault.EncryptedName != encodedSyntheticSyncCiphertext(1, 3) ||
		firstSharedVault.EncryptedVaultKey != encodedSyntheticSyncCiphertext(1, 10) ||
		len(firstSharedVault.Accounts) != 1 || firstSharedVault.Accounts[0].ID != activeViewerSharedAccountID ||
		firstSharedVault.Accounts[0].EncryptedPayload != encodedSyntheticSyncCiphertext(1, 7) {
		t.Fatalf("first actor received incorrect active Viewer ciphertext: %#v", firstSharedVault)
	}

	firstResponse, err := reader.ReadAuthorizedWorkspaceResponse(ctx, firstUserID)
	if err != nil || firstResponse == nil {
		t.Fatalf("read first actor authorized workspace response: response=%#v err=%v", firstResponse, err)
	}
	if firstResponse.PersonalSnapshot.ProfileID != firstUserID ||
		firstResponse.PersonalSnapshot.CryptoProfile.VaultUnlockSalt != base64.StdEncoding.EncodeToString([]byte("synctestsalt0001")) ||
		firstResponse.PersonalSnapshot.CryptoProfile.WrappedUserRootKey != encodedSyntheticSyncCiphertext(1, 13) ||
		firstResponse.PersonalSnapshot.CryptoProfile.EncryptedPersonalVaultKey != encodedSyntheticSyncCiphertext(1, 14) ||
		firstResponse.PersonalSnapshot.PersonalVault.VaultID != firstPersonalVaultID ||
		firstResponse.PersonalSnapshot.PersonalVault.EncryptedName != encodedSyntheticSyncCiphertext(1, 1) ||
		len(firstResponse.PersonalSnapshot.PersonalVault.Accounts) != 1 ||
		firstResponse.PersonalSnapshot.PersonalVault.Accounts[0].ID != firstPersonalAccountID ||
		firstResponse.PersonalSnapshot.PersonalVault.Accounts[0].EncryptedPayload != encodedSyntheticSyncCiphertext(1, 5) ||
		len(firstResponse.SharedVaults) != 1 || firstResponse.SharedVaults[0].VaultID != activeViewerSharedVaultID {
		t.Fatalf("first actor authorized response leaked unrelated data or mishandled active Viewer membership: %#v", firstResponse)
	}
	firstResponseSharedVault := firstResponse.SharedVaults[0]
	if firstResponseSharedVault.Role != "VIEWER" ||
		firstResponseSharedVault.EncryptedName != encodedSyntheticSyncCiphertext(1, 3) ||
		firstResponseSharedVault.EncryptedVaultKey != encodedSyntheticSyncCiphertext(1, 10) ||
		len(firstResponseSharedVault.Accounts) != 1 || firstResponseSharedVault.Accounts[0].ID != activeViewerSharedAccountID ||
		firstResponseSharedVault.Accounts[0].EncryptedPayload != encodedSyntheticSyncCiphertext(1, 7) {
		t.Fatalf("first actor authorized response contained incorrect active Viewer ciphertext: %#v", firstResponseSharedVault)
	}

	secondBundle, err := reader.ReadOnlineWorkspaceBundle(ctx, secondUserID)
	if err != nil || secondBundle == nil {
		t.Fatalf("read second actor workspace bundle: bundle=%#v err=%v", secondBundle, err)
	}
	if secondBundle.ProfileID != secondUserID ||
		secondBundle.CryptoProfile.VaultUnlockSalt != base64.StdEncoding.EncodeToString([]byte("synctestsalt0002")) ||
		secondBundle.CryptoProfile.WrappedUserRootKey != encodedSyntheticSyncCiphertext(1, 15) ||
		secondBundle.CryptoProfile.EncryptedPersonalVaultKey != encodedSyntheticSyncCiphertext(1, 16) ||
		secondBundle.PersonalVault.VaultID != secondPersonalVaultID ||
		secondBundle.PersonalVault.EncryptedName != encodedSyntheticSyncCiphertext(1, 2) ||
		len(secondBundle.PersonalVault.Accounts) != 1 || secondBundle.PersonalVault.Accounts[0].ID != secondPersonalAccountID ||
		secondBundle.PersonalVault.Accounts[0].EncryptedPayload != encodedSyntheticSyncCiphertext(1, 6) ||
		len(secondBundle.SharedVaults) != 2 || secondBundle.SharedVaults[0].VaultID != activeViewerSharedVaultID ||
		secondBundle.SharedVaults[1].VaultID != revokedViewerSharedVaultID {
		t.Fatalf("second actor bundle omitted its own data or included unrelated data: %#v", secondBundle)
	}
	if first := secondBundle.SharedVaults[0]; first.Role != "OWNER" ||
		first.EncryptedName != encodedSyntheticSyncCiphertext(1, 3) ||
		first.EncryptedVaultKey != encodedSyntheticSyncCiphertext(1, 9) ||
		len(first.Accounts) != 1 || first.Accounts[0].ID != activeViewerSharedAccountID ||
		first.Accounts[0].EncryptedPayload != encodedSyntheticSyncCiphertext(1, 7) {
		t.Fatalf("second actor received incorrect active Shared Vault ciphertext: %#v", first)
	}
	if second := secondBundle.SharedVaults[1]; second.Role != "OWNER" ||
		second.EncryptedName != encodedSyntheticSyncCiphertext(1, 4) ||
		second.EncryptedVaultKey != encodedSyntheticSyncCiphertext(1, 11) ||
		len(second.Accounts) != 1 || second.Accounts[0].ID != revokedViewerSharedAccountID ||
		second.Accounts[0].EncryptedPayload != encodedSyntheticSyncCiphertext(1, 8) {
		t.Fatalf("second actor received incorrect second Shared Vault ciphertext: %#v", second)
	}

	secondResponse, err := reader.ReadAuthorizedWorkspaceResponse(ctx, secondUserID)
	if err != nil || secondResponse == nil {
		t.Fatalf("read second actor authorized workspace response: response=%#v err=%v", secondResponse, err)
	}
	if secondResponse.PersonalSnapshot.ProfileID != secondUserID ||
		secondResponse.PersonalSnapshot.CryptoProfile.VaultUnlockSalt != base64.StdEncoding.EncodeToString([]byte("synctestsalt0002")) ||
		secondResponse.PersonalSnapshot.CryptoProfile.WrappedUserRootKey != encodedSyntheticSyncCiphertext(1, 15) ||
		secondResponse.PersonalSnapshot.CryptoProfile.EncryptedPersonalVaultKey != encodedSyntheticSyncCiphertext(1, 16) ||
		secondResponse.PersonalSnapshot.PersonalVault.VaultID != secondPersonalVaultID ||
		secondResponse.PersonalSnapshot.PersonalVault.EncryptedName != encodedSyntheticSyncCiphertext(1, 2) ||
		len(secondResponse.PersonalSnapshot.PersonalVault.Accounts) != 1 ||
		secondResponse.PersonalSnapshot.PersonalVault.Accounts[0].ID != secondPersonalAccountID ||
		secondResponse.PersonalSnapshot.PersonalVault.Accounts[0].EncryptedPayload != encodedSyntheticSyncCiphertext(1, 6) ||
		len(secondResponse.SharedVaults) != 2 || secondResponse.SharedVaults[0].VaultID != activeViewerSharedVaultID ||
		secondResponse.SharedVaults[1].VaultID != revokedViewerSharedVaultID {
		t.Fatalf("second actor authorized response omitted its own data or included unrelated data: %#v", secondResponse)
	}
	if first := secondResponse.SharedVaults[0]; first.Role != "OWNER" ||
		first.EncryptedName != encodedSyntheticSyncCiphertext(1, 3) ||
		first.EncryptedVaultKey != encodedSyntheticSyncCiphertext(1, 9) ||
		len(first.Accounts) != 1 || first.Accounts[0].ID != activeViewerSharedAccountID ||
		first.Accounts[0].EncryptedPayload != encodedSyntheticSyncCiphertext(1, 7) {
		t.Fatalf("second actor authorized response contained incorrect active Shared Vault ciphertext: %#v", first)
	}
	if second := secondResponse.SharedVaults[1]; second.Role != "OWNER" ||
		second.EncryptedName != encodedSyntheticSyncCiphertext(1, 4) ||
		second.EncryptedVaultKey != encodedSyntheticSyncCiphertext(1, 11) ||
		len(second.Accounts) != 1 || second.Accounts[0].ID != revokedViewerSharedAccountID ||
		second.Accounts[0].EncryptedPayload != encodedSyntheticSyncCiphertext(1, 8) {
		t.Fatalf("second actor authorized response contained incorrect second Shared Vault ciphertext: %#v", second)
	}
}

func TestWorkspaceBundleReaderOrdersTiedRowsAndKeepsTokensStable(t *testing.T) {
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
		insertSyncAccount(t, ctx, pool, personalVaultID, accountID, syntheticSyncCiphertext(1), now)
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

	reader, err := NewWorkspaceBundleReader(pool, func() time.Time { return now })
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

func insertSyncCryptoProfile(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID, salt string, now time.Time) {
	insertSyncCryptoProfileWithCiphertext(t, ctx, pool, userID, salt,
		syntheticSyncCiphertext(1), syntheticSyncCiphertext(1), now)
}

func insertSyncCryptoProfileWithCiphertext(
	t *testing.T,
	ctx context.Context,
	pool *pgxpool.Pool,
	userID, salt string,
	wrappedUserRootKey, encryptedPersonalVaultKey []byte,
	now time.Time,
) {
	t.Helper()
	if _, err := pool.Exec(ctx, `
		INSERT INTO user_crypto_profiles (
			user_id, vault_unlock_salt, wrapped_user_root_key, root_key_wrapping_version,
			encrypted_personal_vault_key, personal_vault_key_encryption_version, created_at, updated_at
		)
		VALUES ($1, $2, $3, 1, $4, 1, $5, $5)`,
		userID, []byte(salt), wrappedUserRootKey, encryptedPersonalVaultKey, now); err != nil {
		t.Fatalf("insert synthetic User Crypto Profile: %v", err)
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

func insertSyncAccount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, vaultID, accountID string, encryptedPayload []byte, now time.Time) {
	t.Helper()
	if _, err := pool.Exec(ctx, `
		INSERT INTO authenticator_accounts (id, vault_id, encrypted_payload, encryption_version, revision, created_at, updated_at)
		VALUES ($1, $2, $3, 1, 1, $4, $4)`, accountID, vaultID, encryptedPayload, now); err != nil {
		t.Fatalf("insert synthetic sync account: %v", err)
	}
}

func syntheticSyncCiphertext(version byte) []byte {
	return syntheticSyncCiphertextWithMarker(version, 0)
}

func syntheticSyncCiphertextWithMarker(version, marker byte) []byte {
	value := make([]byte, 29)
	value[0] = version
	for index := 1; index < len(value); index++ {
		value[index] = byte(index + 20 + int(marker))
	}
	return value
}

func encodedSyntheticSyncCiphertext(version, marker byte) string {
	return base64.StdEncoding.EncodeToString(syntheticSyncCiphertextWithMarker(version, marker))
}
