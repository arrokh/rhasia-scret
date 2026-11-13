package infrastructure

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	identity "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity"
	vaultdomain "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-archive/domain"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

func TestPostgresEncryptedVaultImportIntoPersonalVaultIsAtomicAndReplaySafe(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.October, 3, 4, 5, 6, 0, time.UTC)
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	outsiderID := testsupport.CreateSyntheticApplicationUser(t, pool)
	vaultID := "synthetic-import-personal-01"
	insertSyntheticImportVault(t, ctx, pool, vaultID, ownerID, "PERSONAL", now)
	t.Cleanup(func() { deleteSyntheticImportVault(t, ctx, pool, vaultID) })
	repository := newSyntheticImportRepository(t, pool, now)
	request := syntheticExistingImport(vaultID, "PERSONAL", nil,
		"11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222")

	result, err := repository.Import(ctx, ownerID, request)
	if err != nil || result.Status != vaultdomain.ImportStatusImported || result.VaultID != vaultID || result.VaultCreated || len(result.AccountIDs) != 2 {
		t.Fatalf("import encrypted accounts into Personal Vault: result=%#v err=%v", result, err)
	}
	result, err = repository.Import(ctx, ownerID, request)
	if err != nil || result.Status != vaultdomain.ImportStatusReplayed || len(result.AccountIDs) != 2 {
		t.Fatalf("replay encrypted Personal Vault import: result=%#v err=%v", result, err)
	}
	unauthorized, err := repository.Import(ctx, outsiderID, request)
	if err != nil || unauthorized.Status != vaultdomain.ImportStatusDestinationUnavailable {
		t.Fatalf("unauthorized Personal Vault import: result=%#v err=%v", unauthorized, err)
	}
	var accountCount, auditCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM authenticator_accounts WHERE vault_id = $1`, vaultID).Scan(&accountCount); err != nil || accountCount != 2 {
		t.Fatalf("imported account count=%d err=%v; want exactly two", accountCount, err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM vault_audit_events WHERE vault_id = $1 AND event_type = 'ARCHIVE_IMPORTED'`, vaultID).Scan(&auditCount); err != nil || auditCount != 1 {
		t.Fatalf("archive import audit count=%d err=%v; want one", auditCount, err)
	}
}

func TestPostgresEncryptedVaultImportCreatesSharedVaultWithCurrentIdentity(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.November, 4, 5, 6, 7, 0, time.UTC)
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	key := syntheticImportPublicEncryptionKey(t, "F")
	insertSyntheticImportCryptoProfile(t, ctx, pool, ownerID, key, now)
	repository := newSyntheticImportRepository(t, pool, now)
	vaultID := "33333333-3333-4333-8333-333333333333"
	t.Cleanup(func() { deleteSyntheticImportVault(t, ctx, pool, vaultID) })
	request := vaultdomain.EncryptedVaultImport{
		Destination: vaultdomain.Destination{
			Kind: vaultdomain.DestinationNewShared,
			NewShared: vaultdomain.NewSharedVaultDestination{
				VaultID: vaultID, EncryptedName: syntheticImportCiphertext(1),
				EncryptedOwnerVaultKey: syntheticImportCiphertext(2), ExpectedOwnerPublicKey: key, EncryptionVersion: 1,
			},
		},
		Accounts: []vaultdomain.EncryptedImportedAccount{
			{ID: "44444444-4444-4444-8444-444444444444", EncryptedPayload: syntheticImportCiphertext(1), EncryptionVersion: 1},
			{ID: "55555555-5555-4555-8555-555555555555", EncryptedPayload: syntheticImportCiphertext(2), EncryptionVersion: 1},
		},
	}

	result, err := repository.Import(ctx, ownerID, request)
	if err != nil || result.Status != vaultdomain.ImportStatusImported || !result.VaultCreated || result.VaultID != vaultID || len(result.AccountIDs) != 2 {
		t.Fatalf("import into new Shared Vault: result=%#v err=%v", result, err)
	}
	result, err = repository.Import(ctx, ownerID, request)
	if err != nil || result.Status != vaultdomain.ImportStatusReplayed || !result.VaultCreated {
		t.Fatalf("replay new Shared Vault archive import: result=%#v err=%v", result, err)
	}

	var owner, role, status string
	var storedName, storedOwnerKey []byte
	var keyVersion, encryptionVersion int32
	var memberCount, accountCount, auditCount int
	if err := pool.QueryRow(ctx, `
		SELECT vault.owner_id, vault.encrypted_name, vault.encryption_version,
		       member.role, member.status, member.encrypted_vault_key, member.key_version
		FROM vaults AS vault JOIN vault_members AS member ON member.vault_id = vault.id
		WHERE vault.id = $1 AND member.user_id = $2`, vaultID, ownerID).Scan(
		&owner, &storedName, &encryptionVersion, &role, &status, &storedOwnerKey, &keyVersion,
	); err != nil {
		t.Fatalf("read imported Shared Vault and owner wrap: %v", err)
	}
	if owner != ownerID || string(storedName) != string(request.Destination.NewShared.EncryptedName) || encryptionVersion != 1 ||
		role != "OWNER" || status != "ACTIVE" || string(storedOwnerKey) != string(request.Destination.NewShared.EncryptedOwnerVaultKey) || keyVersion != 1 {
		t.Fatalf("imported Shared Vault ciphertext/owner metadata differs from request")
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM vault_members WHERE vault_id = $1`, vaultID).Scan(&memberCount); err != nil || memberCount != 1 {
		t.Fatalf("imported Shared Vault member count=%d err=%v", memberCount, err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM authenticator_accounts WHERE vault_id = $1`, vaultID).Scan(&accountCount); err != nil || accountCount != 2 {
		t.Fatalf("imported Shared Vault account count=%d err=%v", accountCount, err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM vault_audit_events WHERE vault_id = $1 AND event_type = 'ARCHIVE_IMPORTED'`, vaultID).Scan(&auditCount); err != nil || auditCount != 1 {
		t.Fatalf("new Shared Vault archive audit count=%d err=%v", auditCount, err)
	}
}

func TestPostgresEncryptedVaultImportDoesNotReplayUnauthorizedNewSharedDestination(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.December, 5, 6, 7, 8, 0, time.UTC)
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	outsiderID := testsupport.CreateSyntheticApplicationUser(t, pool)
	key := syntheticImportPublicEncryptionKey(t, "G")
	insertSyntheticImportCryptoProfile(t, ctx, pool, ownerID, key, now)
	vaultID := "synthetic-import-shared-unauthorized"
	insertSyntheticImportVault(t, ctx, pool, vaultID, ownerID, "SHARED", now)
	t.Cleanup(func() { deleteSyntheticImportVault(t, ctx, pool, vaultID) })
	if _, err := pool.Exec(ctx, `
		INSERT INTO vault_members (vault_id, user_id, role, status, encrypted_vault_key, key_version, created_at, updated_at)
		VALUES ($1, $2, 'OWNER', 'ACTIVE', $3, 1, $4, $4)`, vaultID, ownerID, []byte("synthetic-owner-wrap"), now); err != nil {
		t.Fatalf("insert synthetic owner membership: %v", err)
	}
	accountID := "66666666-6666-4666-8666-666666666666"
	if _, err := pool.Exec(ctx, `
		INSERT INTO authenticator_accounts (id, vault_id, encrypted_payload, encryption_version, created_at, updated_at)
		VALUES ($1, $2, $3, 1, $4, $4)`, accountID, vaultID, syntheticImportCiphertext(1), now); err != nil {
		t.Fatalf("insert synthetic existing account: %v", err)
	}
	repository := newSyntheticImportRepository(t, pool, now)
	request := vaultdomain.EncryptedVaultImport{
		Destination: vaultdomain.Destination{
			Kind: vaultdomain.DestinationNewShared,
			NewShared: vaultdomain.NewSharedVaultDestination{
				VaultID: vaultID, EncryptedName: syntheticImportCiphertext(1),
				EncryptedOwnerVaultKey: syntheticImportCiphertext(1), ExpectedOwnerPublicKey: key, EncryptionVersion: 1,
			},
		},
		Accounts: []vaultdomain.EncryptedImportedAccount{{ID: accountID, EncryptedPayload: syntheticImportCiphertext(1), EncryptionVersion: 1}},
	}
	result, err := repository.Import(ctx, outsiderID, request)
	if err != nil || result.Status != vaultdomain.ImportStatusConflict {
		t.Fatalf("unauthorized NEW_SHARED replay status=%q err=%v; want conflict", result.Status, err)
	}
	var accountCount, auditCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM authenticator_accounts WHERE id = $1`, accountID).Scan(&accountCount); err != nil || accountCount != 1 {
		t.Fatalf("unauthorized replay changed account count=%d err=%v", accountCount, err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM vault_audit_events WHERE vault_id = $1`, vaultID).Scan(&auditCount); err != nil || auditCount != 0 {
		t.Fatalf("unauthorized replay appended audit events=%d err=%v", auditCount, err)
	}
}

func TestEncryptedVaultImportDomainAllowsEmptyArchiveButRejectsInvalidCiphertext(t *testing.T) {
	personal := vaultdomain.EncryptedVaultImport{
		Destination: vaultdomain.Destination{
			Kind:     vaultdomain.DestinationExisting,
			Existing: vaultdomain.ExistingVaultDestination{VaultID: "synthetic-vault", VaultType: "PERSONAL"},
		},
		Accounts: []vaultdomain.EncryptedImportedAccount{},
	}
	if err := vaultdomain.ValidateEncryptedVaultImport(personal); err != nil {
		t.Fatalf("empty archive should preserve the established API behavior: %v", err)
	}
	personal.Accounts = []vaultdomain.EncryptedImportedAccount{{ID: "synthetic-account", EncryptedPayload: []byte("invalid"), EncryptionVersion: 1}}
	if err := vaultdomain.ValidateEncryptedVaultImport(personal); err == nil {
		t.Fatal("invalid encrypted account payload should be rejected")
	}
}

func newSyntheticImportRepository(t *testing.T, pool *pgxpool.Pool, now time.Time) *PostgresEncryptedVaultImportRepository {
	t.Helper()
	repository, err := NewPostgresEncryptedVaultImportRepository(pool, func() time.Time { return now })
	if err != nil {
		t.Fatalf("create encrypted Vault import repository: %v", err)
	}
	return repository
}

func syntheticExistingImport(vaultID string, vaultType string, keyVersion *int64, accountIDs ...string) vaultdomain.EncryptedVaultImport {
	request := vaultdomain.EncryptedVaultImport{
		Destination: vaultdomain.Destination{
			Kind:     vaultdomain.DestinationExisting,
			Existing: vaultdomain.ExistingVaultDestination{VaultID: vaultID, VaultType: vaultType, ExpectedKeyVersion: keyVersion},
		},
		Accounts: make([]vaultdomain.EncryptedImportedAccount, 0, len(accountIDs)),
	}
	for index, accountID := range accountIDs {
		request.Accounts = append(request.Accounts, vaultdomain.EncryptedImportedAccount{
			ID: accountID, EncryptedPayload: syntheticImportCiphertext(byte(index + 1)), EncryptionVersion: 1,
		})
	}
	return request
}

func insertSyntheticImportVault(t *testing.T, ctx context.Context, pool *pgxpool.Pool, vaultID string, ownerID string, vaultType string, now time.Time) {
	t.Helper()
	if _, err := pool.Exec(ctx, `
		INSERT INTO vaults (id, type, lifecycle, owner_id, encrypted_name, encryption_version, created_at, updated_at)
		VALUES ($1, $2, 'ACTIVE', $3, $4, 1, $5, $5)`, vaultID, vaultType, ownerID, []byte("synthetic-vault-name"), now); err != nil {
		t.Fatalf("insert synthetic import destination Vault: %v", err)
	}
}

func syntheticImportPublicEncryptionKey(t *testing.T, xCharacter string) identity.PublicEncryptionKey {
	t.Helper()
	key, err := identity.ParsePublicEncryptionKey([]byte(`{"kty":"EC","crv":"P-256","x":"` + strings.Repeat(xCharacter, 43) + `","y":"` + strings.Repeat("B", 43) + `"}`))
	if err != nil {
		t.Fatalf("parse synthetic User Encryption public key: %v", err)
	}
	return key
}

func insertSyntheticImportCryptoProfile(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string, key identity.PublicEncryptionKey, now time.Time) {
	t.Helper()
	serialized, err := json.Marshal(key)
	if err != nil {
		t.Fatalf("encode synthetic User Encryption public key: %v", err)
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

func syntheticImportCiphertext(prefix byte) []byte {
	payload := make([]byte, 29)
	payload[0] = prefix
	for index := 1; index < len(payload); index++ {
		payload[index] = byte(index + 30)
	}
	return payload
}

func deleteSyntheticImportVault(t *testing.T, ctx context.Context, pool *pgxpool.Pool, vaultID string) {
	t.Helper()
	if _, err := pool.Exec(ctx, `DELETE FROM vault_audit_events WHERE vault_id = $1`, vaultID); err != nil {
		t.Errorf("delete synthetic import audit events: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM authenticator_accounts WHERE vault_id = $1`, vaultID); err != nil {
		t.Errorf("delete synthetic import accounts: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM vault_invitations WHERE vault_id = $1`, vaultID); err != nil {
		t.Errorf("delete synthetic import invitations: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM vault_members WHERE vault_id = $1`, vaultID); err != nil {
		t.Errorf("delete synthetic import memberships: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM vaults WHERE id = $1`, vaultID); err != nil {
		t.Errorf("delete synthetic import destination Vault: %v", err)
	}
}
