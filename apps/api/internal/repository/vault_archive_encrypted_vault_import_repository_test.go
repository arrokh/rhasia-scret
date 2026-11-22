package repository

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	apiEntity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity"
	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

func TestEncryptedVaultImportIntoPersonalVaultIsAtomicAndReplaySafe(t *testing.T) {
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
	if err != nil || result.Status != apiEntity.ImportStatusImported || result.VaultID != vaultID || result.VaultCreated || len(result.AccountIDs) != 2 {
		t.Fatalf("import encrypted accounts into Personal Vault: result=%#v err=%v", result, err)
	}
	result, err = repository.Import(ctx, ownerID, request)
	if err != nil || result.Status != apiEntity.ImportStatusReplayed || len(result.AccountIDs) != 2 {
		t.Fatalf("replay encrypted Personal Vault import: result=%#v err=%v", result, err)
	}
	changedCiphertext := cloneSyntheticImportRequest(request)
	changedCiphertext.Accounts[0].EncryptedPayload[1] ^= 1
	result, err = repository.Import(ctx, ownerID, changedCiphertext)
	if err != nil || result.Status != apiEntity.ImportStatusConflict {
		t.Fatalf("different ciphertext with existing Personal Vault account IDs: result=%#v err=%v", result, err)
	}
	var storedPayload []byte
	if err := pool.QueryRow(ctx, `SELECT encrypted_payload FROM authenticator_accounts WHERE id = $1`, request.Accounts[0].ID).Scan(&storedPayload); err != nil {
		t.Fatalf("read Personal Vault account after conflicting import: %v", err)
	}
	if !bytes.Equal(storedPayload, request.Accounts[0].EncryptedPayload) {
		clear(storedPayload)
		t.Fatal("conflicting archive import changed the existing encrypted account")
	}
	clear(storedPayload)
	if _, err := pool.Exec(ctx, `UPDATE authenticator_accounts SET encryption_version = 2 WHERE id = $1`, request.Accounts[0].ID); err != nil {
		t.Fatalf("change stored synthetic account encryption version: %v", err)
	}
	result, err = repository.Import(ctx, ownerID, request)
	if err != nil || result.Status != apiEntity.ImportStatusConflict {
		t.Fatalf("replay with changed stored account encryption version: result=%#v err=%v", result, err)
	}
	if _, err := pool.Exec(ctx, `UPDATE authenticator_accounts SET encryption_version = 1 WHERE id = $1`, request.Accounts[0].ID); err != nil {
		t.Fatalf("restore synthetic account encryption version: %v", err)
	}
	deletedAt := now
	purgeAfter := apiEntity.AccountPurgeAfter(deletedAt)
	if _, err := pool.Exec(ctx, `UPDATE authenticator_accounts SET deleted_at = $2, purge_after = $3 WHERE id = $1`, request.Accounts[1].ID, deletedAt, purgeAfter); err != nil {
		t.Fatalf("soft-delete synthetic imported account: %v", err)
	}
	result, err = repository.Import(ctx, ownerID, request)
	if err != nil || result.Status != apiEntity.ImportStatusConflict {
		t.Fatalf("import over a soft-deleted Personal Vault account: result=%#v err=%v", result, err)
	}
	unauthorized, err := repository.Import(ctx, outsiderID, request)
	if err != nil || unauthorized.Status != apiEntity.ImportStatusDestinationUnavailable {
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

func TestEncryptedVaultImportSharedReplayRequiresCurrentMemberKeyVersion(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.November, 4, 5, 6, 7, 0, time.UTC)
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	vaultID := "synthetic-import-shared-key-version"
	insertSyntheticImportVault(t, ctx, pool, vaultID, ownerID, "SHARED", now)
	t.Cleanup(func() { deleteSyntheticImportVault(t, ctx, pool, vaultID) })
	if _, err := pool.Exec(ctx, `
		INSERT INTO vault_members (vault_id, user_id, role, status, encrypted_vault_key, key_version, created_at, updated_at)
		VALUES ($1, $2, 'OWNER', 'ACTIVE', $3, 1, $4, $4)`, vaultID, ownerID, []byte("synthetic-owner-wrap"), now); err != nil {
		t.Fatalf("insert synthetic owner membership: %v", err)
	}
	keyVersion := int64(1)
	request := syntheticExistingImport(vaultID, "SHARED", &keyVersion, "77777777-7777-4777-8777-777777777777")
	repository := newSyntheticImportRepository(t, pool, now)

	result, err := repository.Import(ctx, ownerID, request)
	if err != nil || result.Status != apiEntity.ImportStatusImported {
		t.Fatalf("import into existing Shared Vault: result=%#v err=%v", result, err)
	}
	result, err = repository.Import(ctx, ownerID, request)
	if err != nil || result.Status != apiEntity.ImportStatusReplayed {
		t.Fatalf("replay into existing Shared Vault with current key version: result=%#v err=%v", result, err)
	}
	if _, err := pool.Exec(ctx, `UPDATE vault_members SET key_version = 2 WHERE vault_id = $1 AND user_id = $2`, vaultID, ownerID); err != nil {
		t.Fatalf("advance synthetic Shared Vault owner key version: %v", err)
	}
	result, err = repository.Import(ctx, ownerID, request)
	if err != nil || result.Status != apiEntity.ImportStatusConflict {
		t.Fatalf("replay into Shared Vault with stale owner key version: result=%#v err=%v", result, err)
	}
	result, err = repository.readReplayOrConflict(ctx, ownerID, request)
	if err != nil || result.Status != apiEntity.ImportStatusConflict {
		t.Fatalf("unique-violation replay recovery with stale owner key version: result=%#v err=%v", result, err)
	}
}

func TestEncryptedVaultImportCreatesSharedVaultWithCurrentIdentity(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.November, 4, 5, 6, 7, 0, time.UTC)
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	key := syntheticImportPublicEncryptionKey(t, "F")
	insertSyntheticImportCryptoProfile(t, ctx, pool, ownerID, key, now)
	repository := newSyntheticImportRepository(t, pool, now)
	vaultID := "33333333-3333-4333-8333-333333333333"
	t.Cleanup(func() { deleteSyntheticImportVault(t, ctx, pool, vaultID) })
	request := apiEntity.EncryptedVaultImport{
		Destination: apiEntity.Destination{
			Kind: apiEntity.DestinationNewShared,
			NewShared: apiEntity.NewSharedVaultDestination{
				VaultID: vaultID, EncryptedName: syntheticImportCiphertext(1),
				EncryptedOwnerVaultKey: syntheticImportCiphertext(2), ExpectedOwnerPublicKey: key, EncryptionVersion: 1,
			},
		},
		Accounts: []apiEntity.EncryptedImportedAccount{
			{ID: "44444444-4444-4444-8444-444444444444", EncryptedPayload: syntheticImportCiphertext(1), EncryptionVersion: 1},
			{ID: "55555555-5555-4555-8555-555555555555", EncryptedPayload: syntheticImportCiphertext(2), EncryptionVersion: 1},
		},
	}

	result, err := repository.Import(ctx, ownerID, request)
	if err != nil || result.Status != apiEntity.ImportStatusImported || !result.VaultCreated || result.VaultID != vaultID || len(result.AccountIDs) != 2 {
		t.Fatalf("import into new Shared Vault: result=%#v err=%v", result, err)
	}
	result, err = repository.Import(ctx, ownerID, request)
	if err != nil || result.Status != apiEntity.ImportStatusReplayed || !result.VaultCreated {
		t.Fatalf("replay new Shared Vault archive import: result=%#v err=%v", result, err)
	}
	futureEncryptionVersionRequest := cloneSyntheticImportRequest(request)
	futureEncryptionVersionRequest.Destination.NewShared.EncryptionVersion = 2
	if _, err := pool.Exec(ctx, `UPDATE vaults SET encryption_version = 2 WHERE id = $1`, vaultID); err != nil {
		t.Fatalf("advance synthetic Shared Vault encryption version: %v", err)
	}
	transaction, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin future-version replay verification: %v", err)
	}
	result, err = replayResult(ctx, transaction, ownerID, futureEncryptionVersionRequest)
	if rollbackErr := transaction.Rollback(ctx); rollbackErr != nil {
		t.Fatalf("roll back future-version replay verification: %v", rollbackErr)
	}
	if _, err := pool.Exec(ctx, `UPDATE vaults SET encryption_version = 1 WHERE id = $1`, vaultID); err != nil {
		t.Fatalf("restore synthetic Shared Vault encryption version: %v", err)
	}
	if err != nil || result.Status != apiEntity.ImportStatusReplayed {
		t.Fatalf("replay with an independent Vault encryption version: result=%#v err=%v", result, err)
	}
	mismatches := []struct {
		name   string
		change func(*apiEntity.EncryptedVaultImport)
	}{
		{name: "Vault name", change: func(importRequest *apiEntity.EncryptedVaultImport) {
			importRequest.Destination.NewShared.EncryptedName[1] ^= 1
		}},
		{name: "owner key wrap", change: func(importRequest *apiEntity.EncryptedVaultImport) {
			importRequest.Destination.NewShared.EncryptedOwnerVaultKey[1] ^= 1
		}},
		{name: "account ciphertext", change: func(importRequest *apiEntity.EncryptedVaultImport) {
			importRequest.Accounts[0].EncryptedPayload[1] ^= 1
		}},
		{name: "owner public key", change: func(importRequest *apiEntity.EncryptedVaultImport) {
			importRequest.Destination.NewShared.ExpectedOwnerPublicKey = syntheticImportPublicEncryptionKey(t, "G")
		}},
	}
	for _, mismatch := range mismatches {
		t.Run(mismatch.name, func(t *testing.T) {
			altered := cloneSyntheticImportRequest(request)
			mismatch.change(&altered)
			result, err := repository.Import(ctx, ownerID, altered)
			if err != nil || result.Status != apiEntity.ImportStatusConflict {
				t.Fatalf("changed %s in an existing NEW_SHARED destination: result=%#v err=%v", mismatch.name, result, err)
			}
		})
	}

	if _, err := pool.Exec(ctx, `UPDATE vault_members SET key_version = 2 WHERE vault_id = $1 AND user_id = $2`, vaultID, ownerID); err != nil {
		t.Fatalf("advance imported Shared Vault owner key generation: %v", err)
	}
	result, err = repository.Import(ctx, ownerID, request)
	if err != nil || result.Status != apiEntity.ImportStatusConflict {
		t.Fatalf("replay after owner key generation changed: result=%#v err=%v", result, err)
	}
	if _, err := pool.Exec(ctx, `UPDATE vault_members SET key_version = 1 WHERE vault_id = $1 AND user_id = $2`, vaultID, ownerID); err != nil {
		t.Fatalf("restore imported Shared Vault owner key generation: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE vaults SET encryption_version = 2 WHERE id = $1`, vaultID); err != nil {
		t.Fatalf("change imported Shared Vault encryption version: %v", err)
	}
	result, err = repository.Import(ctx, ownerID, request)
	if err != nil || result.Status != apiEntity.ImportStatusConflict {
		t.Fatalf("replay after stored Vault encryption version changed: result=%#v err=%v", result, err)
	}
	if _, err := pool.Exec(ctx, `UPDATE vaults SET encryption_version = 1 WHERE id = $1`, vaultID); err != nil {
		t.Fatalf("restore imported Shared Vault encryption version: %v", err)
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

func TestEncryptedVaultImportUniqueViolationRecoveryRechecksMemberAuthorization(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.December, 6, 7, 8, 9, 0, time.UTC)
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	viewerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	vaultID := "synthetic-import-shared-unique-collision"
	insertSyntheticImportVault(t, ctx, pool, vaultID, ownerID, "SHARED", now)
	t.Cleanup(func() { deleteSyntheticImportVault(t, ctx, pool, vaultID) })
	if _, err := pool.Exec(ctx, `UPDATE vaults SET members_can_add_accounts = true WHERE id = $1`, vaultID); err != nil {
		t.Fatalf("enable synthetic Shared Vault add permission: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO vault_members (vault_id, user_id, role, status, encrypted_vault_key, key_version, created_at, updated_at)
		VALUES ($1, $2, 'OWNER', 'ACTIVE', $3, 1, $4, $4),
		       ($1, $5, 'VIEWER', 'ACTIVE', $6, 1, $4, $4)`,
		vaultID, ownerID, []byte("synthetic-owner-wrap"), now, viewerID, []byte("synthetic-viewer-wrap")); err != nil {
		t.Fatalf("insert synthetic Shared Vault memberships: %v", err)
	}
	indexName := "synthetic_archive_import_unique_vault_" + strings.ReplaceAll(vaultID, "-", "_")
	if _, err := pool.Exec(ctx, `CREATE UNIQUE INDEX `+indexName+` ON authenticator_accounts (vault_id) WHERE vault_id = '`+vaultID+`'`); err != nil {
		t.Fatalf("create disposable synthetic unique index: %v", err)
	}
	t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(), `DROP INDEX IF EXISTS `+indexName); err != nil {
			t.Errorf("drop disposable synthetic unique index: %v", err)
		}
	})
	keyVersion := int64(1)
	request := syntheticExistingImport(vaultID, "SHARED", &keyVersion,
		"88888888-8888-4888-8888-888888888888", "99999999-9999-4999-8999-999999999999")
	repository := newSyntheticImportRepository(t, pool, now)

	result, err := repository.Import(ctx, viewerID, request)
	if err != nil || result.Status != apiEntity.ImportStatusConflict {
		t.Fatalf("unique violation should recover to conflict without partial import: result=%#v err=%v", result, err)
	}

	transaction, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin synthetic unique violation recovery: %v", err)
	}
	_, importErr := repository.importInTransaction(ctx, transaction, viewerID, request)
	if !isVaultArchiveUniqueViolation(importErr) {
		_ = transaction.Rollback(ctx)
		t.Fatalf("create synthetic import uniqueness collision: err=%v", importErr)
	}
	if err := transaction.Rollback(ctx); err != nil {
		t.Fatalf("roll back synthetic colliding import: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE vault_members SET status = 'REVOKED' WHERE vault_id = $1 AND user_id = $2`, vaultID, viewerID); err != nil {
		t.Fatalf("revoke synthetic Viewer before replay recovery: %v", err)
	}
	result, err = repository.readReplayOrConflict(ctx, viewerID, request)
	if err != nil || result.Status != apiEntity.ImportStatusConflict {
		t.Fatalf("unique violation recovery after Viewer revocation: result=%#v err=%v", result, err)
	}
	var accountCount, auditCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM authenticator_accounts WHERE vault_id = $1`, vaultID).Scan(&accountCount); err != nil || accountCount != 0 {
		t.Fatalf("colliding import left accounts=%d err=%v", accountCount, err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM vault_audit_events WHERE vault_id = $1`, vaultID).Scan(&auditCount); err != nil || auditCount != 0 {
		t.Fatalf("unauthorized replay wrote audit events=%d err=%v", auditCount, err)
	}
}

func TestEncryptedVaultImportDoesNotReplayUnauthorizedNewSharedDestination(t *testing.T) {
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
	request := apiEntity.EncryptedVaultImport{
		Destination: apiEntity.Destination{
			Kind: apiEntity.DestinationNewShared,
			NewShared: apiEntity.NewSharedVaultDestination{
				VaultID: vaultID, EncryptedName: syntheticImportCiphertext(1),
				EncryptedOwnerVaultKey: syntheticImportCiphertext(1), ExpectedOwnerPublicKey: key, EncryptionVersion: 1,
			},
		},
		Accounts: []apiEntity.EncryptedImportedAccount{{ID: accountID, EncryptedPayload: syntheticImportCiphertext(1), EncryptionVersion: 1}},
	}
	result, err := repository.Import(ctx, outsiderID, request)
	if err != nil || result.Status != apiEntity.ImportStatusConflict {
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
	personal := apiEntity.EncryptedVaultImport{
		Destination: apiEntity.Destination{
			Kind:     apiEntity.DestinationExisting,
			Existing: apiEntity.ExistingVaultDestination{VaultID: "synthetic-vault", VaultType: "PERSONAL"},
		},
		Accounts: []apiEntity.EncryptedImportedAccount{},
	}
	if err := apiEntity.ValidateEncryptedVaultImport(personal); err != nil {
		t.Fatalf("empty archive should preserve the established API behavior: %v", err)
	}
	personal.Accounts = []apiEntity.EncryptedImportedAccount{{ID: "synthetic-account", EncryptedPayload: []byte("invalid"), EncryptionVersion: 1}}
	if err := apiEntity.ValidateEncryptedVaultImport(personal); err == nil {
		t.Fatal("invalid encrypted account payload should be rejected")
	}
}

func cloneSyntheticImportRequest(request apiEntity.EncryptedVaultImport) apiEntity.EncryptedVaultImport {
	clone := request
	clone.Destination.NewShared.EncryptedName = append([]byte(nil), request.Destination.NewShared.EncryptedName...)
	clone.Destination.NewShared.EncryptedOwnerVaultKey = append([]byte(nil), request.Destination.NewShared.EncryptedOwnerVaultKey...)
	clone.Accounts = make([]apiEntity.EncryptedImportedAccount, len(request.Accounts))
	for index, account := range request.Accounts {
		clone.Accounts[index] = account
		clone.Accounts[index].EncryptedPayload = append([]byte(nil), account.EncryptedPayload...)
	}
	return clone
}

func newSyntheticImportRepository(t *testing.T, pool *pgxpool.Pool, now time.Time) *EncryptedVaultImportRepository {
	t.Helper()
	repository, err := NewEncryptedVaultImportRepository(pool, func() time.Time { return now })
	if err != nil {
		t.Fatalf("create encrypted Vault import repository: %v", err)
	}
	return repository
}

func syntheticExistingImport(vaultID string, vaultType string, keyVersion *int64, accountIDs ...string) apiEntity.EncryptedVaultImport {
	request := apiEntity.EncryptedVaultImport{
		Destination: apiEntity.Destination{
			Kind:     apiEntity.DestinationExisting,
			Existing: apiEntity.ExistingVaultDestination{VaultID: vaultID, VaultType: vaultType, ExpectedKeyVersion: keyVersion},
		},
		Accounts: make([]apiEntity.EncryptedImportedAccount, 0, len(accountIDs)),
	}
	for index, accountID := range accountIDs {
		request.Accounts = append(request.Accounts, apiEntity.EncryptedImportedAccount{
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

func syntheticImportPublicEncryptionKey(t *testing.T, xCharacter string) apiService.UserEncryptionPublicKey {
	t.Helper()
	key, err := apiService.ParseUserEncryptionPublicKey([]byte(`{"kty":"EC","crv":"P-256","x":"` + strings.Repeat(xCharacter, 43) + `","y":"` + strings.Repeat("B", 43) + `"}`))
	if err != nil {
		t.Fatalf("parse synthetic User Encryption public key: %v", err)
	}
	return key
}

func insertSyntheticImportCryptoProfile(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string, key apiService.UserEncryptionPublicKey, now time.Time) {
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
