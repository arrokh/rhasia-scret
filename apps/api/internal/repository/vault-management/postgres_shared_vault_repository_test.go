package infrastructure

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	vaultdomain "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity/vault-management"
	identity "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity"
	vaultapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/vault-management"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

func TestPostgresSharedVaultRepositoryCreatesOwnerVaultOnlyForCurrentIdentity(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.February, 3, 4, 5, 6, 0, time.UTC)
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	key := syntheticPublicEncryptionKey(t, "A")
	insertSyntheticCryptoProfile(t, ctx, pool, ownerID, key, now)
	repository, err := NewPostgresSharedVaultRepository(pool, func() time.Time { return now })
	if err != nil {
		t.Fatalf("create Shared Vault repository: %v", err)
	}
	vaultID := "synthetic-shared-vault-01"
	vault, err := repository.Create(ctx, ownerID, vaultapp.NewSharedVault{
		ID:                     vaultID,
		EncryptedName:          []byte("synthetic-encrypted-name"),
		EncryptedOwnerVaultKey: []byte("synthetic-owner-key-wrap"),
		ExpectedOwnerPublicKey: key,
		EncryptionVersion:      1,
	})
	if err != nil {
		t.Fatalf("create synthetic Shared Vault: %v", err)
	}
	if vault != (vaultdomain.Vault{ID: vaultID, Type: vaultdomain.VaultTypeShared, OwnerID: ownerID, Lifecycle: vaultdomain.VaultLifecycleActive}) {
		t.Fatalf("unexpected Shared Vault domain result: %#v", vault)
	}
	t.Cleanup(func() { deleteSyntheticSharedVault(t, ctx, pool, vaultID) })

	var encryptedName, encryptedOwnerKey []byte
	var vaultType, lifecycle, role, status string
	var owner string
	var encryptionVersion, keyVersion int32
	var addDefault, editDefault, deleteDefault bool
	var addOverride, editOverride, deleteOverride *bool
	err = pool.QueryRow(ctx, `
		SELECT vault.type, vault.lifecycle, vault.owner_id, vault.encrypted_name, vault.encryption_version,
		       vault.members_can_add_accounts, vault.members_can_edit_accounts, vault.members_can_delete_accounts,
		       member.role, member.status, member.encrypted_vault_key, member.key_version,
		       member.can_add_accounts_override, member.can_edit_accounts_override, member.can_delete_accounts_override
		FROM vaults AS vault
		JOIN vault_members AS member ON member.vault_id = vault.id
		WHERE vault.id = $1 AND member.user_id = $2`, vaultID, ownerID).Scan(
		&vaultType, &lifecycle, &owner, &encryptedName, &encryptionVersion,
		&addDefault, &editDefault, &deleteDefault,
		&role, &status, &encryptedOwnerKey, &keyVersion,
		&addOverride, &editOverride, &deleteOverride,
	)
	if err != nil {
		t.Fatalf("read created synthetic Shared Vault: %v", err)
	}
	if vaultType != "SHARED" || lifecycle != "ACTIVE" || owner != ownerID || string(encryptedName) != "synthetic-encrypted-name" || encryptionVersion != 1 ||
		addDefault || editDefault || deleteDefault || role != "OWNER" || status != "ACTIVE" ||
		string(encryptedOwnerKey) != "synthetic-owner-key-wrap" || keyVersion != 1 || addOverride != nil || editOverride != nil || deleteOverride != nil {
		t.Fatalf("created Shared Vault metadata differs from the API contract")
	}
	var auditCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM vault_audit_events WHERE vault_id = $1`, vaultID).Scan(&auditCount); err != nil || auditCount != 0 {
		t.Fatalf("Shared Vault creation audit count=%d err=%v; creation does not append an audit event", auditCount, err)
	}

	changedKey := syntheticPublicEncryptionKey(t, "C")
	_, err = repository.Create(ctx, ownerID, vaultapp.NewSharedVault{
		ID:                     "synthetic-shared-vault-stale-01",
		EncryptedName:          []byte("synthetic-encrypted-name"),
		EncryptedOwnerVaultKey: []byte("synthetic-owner-key-wrap"),
		ExpectedOwnerPublicKey: changedKey,
		EncryptionVersion:      1,
	})
	if !errors.Is(err, vaultapp.ErrSharedVaultIdentityConflict) {
		t.Fatalf("stale User Encryption identity error=%v; want conflict", err)
	}
	var staleVaultCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM vaults WHERE id = $1`, "synthetic-shared-vault-stale-01").Scan(&staleVaultCount); err != nil || staleVaultCount != 0 {
		t.Fatalf("stale identity created a Shared Vault: count=%d err=%v", staleVaultCount, err)
	}
}

func TestPostgresSharedVaultRepositoryRenameRequiresCurrentOwnerKeyVersion(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.March, 4, 5, 6, 7, 0, time.UTC)
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	key := syntheticPublicEncryptionKey(t, "D")
	insertSyntheticCryptoProfile(t, ctx, pool, ownerID, key, now)
	repository, err := NewPostgresSharedVaultRepository(pool, func() time.Time { return now })
	if err != nil {
		t.Fatalf("create Shared Vault repository: %v", err)
	}
	vaultID := "synthetic-shared-vault-02"
	_, err = repository.Create(ctx, ownerID, vaultapp.NewSharedVault{
		ID:                     vaultID,
		EncryptedName:          []byte("synthetic-encrypted-name"),
		EncryptedOwnerVaultKey: []byte("synthetic-owner-key-wrap"),
		ExpectedOwnerPublicKey: key,
		EncryptionVersion:      1,
	})
	if err != nil {
		t.Fatalf("create synthetic Shared Vault for rename: %v", err)
	}
	t.Cleanup(func() { deleteSyntheticSharedVault(t, ctx, pool, vaultID) })

	replacement := []byte("synthetic-replacement-name")
	renamed, err := repository.Rename(ctx, ownerID, vaultID, replacement, 1, 1)
	if err != nil || !renamed {
		t.Fatalf("rename Shared Vault: renamed=%t err=%v", renamed, err)
	}
	var storedName []byte
	if err := pool.QueryRow(ctx, `SELECT encrypted_name FROM vaults WHERE id = $1`, vaultID).Scan(&storedName); err != nil || string(storedName) != string(replacement) {
		t.Fatalf("renamed Shared Vault ciphertext=%q err=%v", storedName, err)
	}

	renamed, err = repository.Rename(ctx, ownerID, vaultID, []byte("synthetic-stale-name"), 1, 2)
	if renamed || !errors.Is(err, vaultapp.ErrSharedVaultKeyVersionConflict) {
		t.Fatalf("stale key-version rename: renamed=%t err=%v; want conflict", renamed, err)
	}
	outsiderID := testsupport.CreateSyntheticApplicationUser(t, pool)
	renamed, err = repository.Rename(ctx, outsiderID, vaultID, []byte("synthetic-outsider-name"), 1, 1)
	if err != nil || renamed {
		t.Fatalf("non-owner rename: renamed=%t err=%v; want unavailable", renamed, err)
	}
	if err := pool.QueryRow(ctx, `SELECT encrypted_name FROM vaults WHERE id = $1`, vaultID).Scan(&storedName); err != nil || string(storedName) != string(replacement) {
		t.Fatalf("failed rename changed encrypted Vault name: %q err=%v", storedName, err)
	}
}

func TestPostgresSharedVaultNameMigrationIsMemberScopedAndReplaySafe(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.April, 5, 6, 7, 8, 0, time.UTC)
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	viewerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	outsiderID := testsupport.CreateSyntheticApplicationUser(t, pool)
	key := syntheticPublicEncryptionKey(t, "E")
	insertSyntheticCryptoProfile(t, ctx, pool, ownerID, key, now)
	repository, err := NewPostgresSharedVaultRepository(pool, func() time.Time { return now })
	if err != nil {
		t.Fatalf("create Shared Vault repository: %v", err)
	}
	vaultID := "synthetic-shared-vault-03"
	legacyName := []byte{1, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22}
	_, err = repository.Create(ctx, ownerID, vaultapp.NewSharedVault{
		ID:                     vaultID,
		EncryptedName:          legacyName,
		EncryptedOwnerVaultKey: []byte("synthetic-owner-key-wrap"),
		ExpectedOwnerPublicKey: key,
		EncryptionVersion:      1,
	})
	if err != nil {
		t.Fatalf("create synthetic Shared Vault for migration: %v", err)
	}
	t.Cleanup(func() { deleteSyntheticSharedVault(t, ctx, pool, vaultID) })
	if _, err := pool.Exec(ctx, `
		INSERT INTO vault_members (vault_id, user_id, role, status, encrypted_vault_key, key_version, created_at, updated_at)
		VALUES ($1, $2, 'VIEWER', 'ACTIVE', $3, 2, $4, $4)`,
		vaultID, viewerID, []byte("synthetic-viewer-key-wrap"), now.Add(time.Second)); err != nil {
		t.Fatalf("insert synthetic Shared Vault viewer: %v", err)
	}

	replacement := make([]byte, 29)
	replacement[0] = 2
	for index := 1; index < len(replacement); index++ {
		replacement[index] = byte(index + 40)
	}
	replacementDigest := sharedapp.SHA256Base64URL(replacement)
	migration := sharedapp.EncryptedPayloadMigration{
		ExpectedEnvelopeVersion:     1,
		ReplacementEnvelopeVersion:  2,
		ExpectedCiphertextDigest:    sharedapp.SHA256Base64URL(legacyName),
		ReplacementCiphertextDigest: replacementDigest,
		ReplacementCiphertext:       replacement,
		OperationID:                 replacementDigest,
	}
	result, err := repository.MigrateName(ctx, viewerID, vaultID, 2, migration)
	if err != nil || result != sharedapp.EncryptedPayloadMigrationCommitted {
		t.Fatalf("migrate Shared Vault name as Viewer: result=%q err=%v", result, err)
	}
	var storedName []byte
	var encryptionVersion int32
	if err := pool.QueryRow(ctx, `SELECT encrypted_name, encryption_version FROM vaults WHERE id = $1`, vaultID).Scan(&storedName, &encryptionVersion); err != nil ||
		string(storedName) != string(replacement) || encryptionVersion != 1 {
		t.Fatalf("Shared Vault name migration stored=%v version=%d err=%v", storedName, encryptionVersion, err)
	}
	result, err = repository.MigrateName(ctx, viewerID, vaultID, 2, migration)
	if err != nil || result != sharedapp.EncryptedPayloadMigrationAlreadyCommitted {
		t.Fatalf("replay Shared Vault name migration: result=%q err=%v", result, err)
	}
	result, err = repository.MigrateName(ctx, viewerID, vaultID, 1, migration)
	if err != nil || result != sharedapp.EncryptedPayloadMigrationConflict {
		t.Fatalf("stale key-version Shared Vault name migration: result=%q err=%v", result, err)
	}
	result, err = repository.MigrateName(ctx, outsiderID, vaultID, 2, migration)
	if err != nil || result != sharedapp.EncryptedPayloadMigrationConflict {
		t.Fatalf("non-member Shared Vault name migration: result=%q err=%v", result, err)
	}
}

func syntheticPublicEncryptionKey(t *testing.T, xCharacter string) identity.PublicEncryptionKey {
	t.Helper()
	key, err := identity.ParsePublicEncryptionKey([]byte(`{"kty":"EC","crv":"P-256","x":"` + strings.Repeat(xCharacter, 43) + `","y":"` + strings.Repeat("B", 43) + `"}`))
	if err != nil {
		t.Fatalf("parse synthetic public encryption key: %v", err)
	}
	return key
}

func insertSyntheticCryptoProfile(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string, key identity.PublicEncryptionKey, now time.Time) {
	t.Helper()
	serialized, err := json.Marshal(key)
	if err != nil {
		t.Fatalf("encode synthetic public encryption key: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO user_crypto_profiles (
			user_id, vault_unlock_salt, wrapped_user_root_key, root_key_wrapping_version,
			encrypted_personal_vault_key, personal_vault_key_encryption_version, user_encryption_public_key,
			created_at, updated_at
		)
		VALUES ($1, $2, $3, 1, $4, 1, $5::jsonb, $6, $6)`,
		userID, []byte("synthetic-salt"), []byte("synthetic-root-wrap"), []byte("synthetic-personal-vault-key"), string(serialized), now); err != nil {
		t.Fatalf("insert synthetic User Crypto Profile: %v", err)
	}
}

func deleteSyntheticSharedVault(t *testing.T, ctx context.Context, pool *pgxpool.Pool, vaultID string) {
	t.Helper()
	if _, err := pool.Exec(ctx, `DELETE FROM vault_audit_events WHERE vault_id = $1`, vaultID); err != nil {
		t.Errorf("delete synthetic Shared Vault audit rows: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM authenticator_accounts WHERE vault_id = $1`, vaultID); err != nil {
		t.Errorf("delete synthetic Shared Vault accounts: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM vault_members WHERE vault_id = $1`, vaultID); err != nil {
		t.Errorf("delete synthetic Shared Vault memberships: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM vaults WHERE id = $1`, vaultID); err != nil {
		t.Errorf("delete synthetic Shared Vault row: %v", err)
	}
}
