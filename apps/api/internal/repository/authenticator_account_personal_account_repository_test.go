package repository

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	apiEntity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity"
	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

func TestPersonalAccountCreateSerializesWithPersonalVaultReset(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	now := time.Date(2026, time.June, 7, 8, 9, 10, 0, time.UTC)
	ownerID, vaultID := createActiveSyntheticPersonalVault(t, ctx, pool, now)
	repository, err := NewPersonalAccountRepository(pool, func() time.Time { return now })
	if err != nil {
		t.Fatalf("create Personal Account repository: %v", err)
	}
	resetTransaction, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin synthetic reset transaction: %v", err)
	}
	defer func() { _ = resetTransaction.Rollback(context.Background()) }()
	var lockedVaultID string
	if err := resetTransaction.QueryRow(ctx, `
		SELECT id FROM vaults
		WHERE owner_id = $1 AND type = 'PERSONAL'
		ORDER BY created_at ASC
		LIMIT 1
		FOR UPDATE`, ownerID).Scan(&lockedVaultID); err != nil || lockedVaultID != vaultID {
		t.Fatalf("lock synthetic Personal Vault for reset id=%q err=%v", lockedVaultID, err)
	}
	createResult := make(chan error, 1)
	started := make(chan struct{})
	go func() {
		close(started)
		account, createErr := repository.Create(ctx, ownerID, vaultID, apiService.NewEncryptedAccount{
			EncryptedPayload: syntheticPersonalAccountEnvelope(1, 64), EncryptionVersion: 1,
		})
		account.Clear()
		createResult <- createErr
	}()
	<-started
	waitForPersonalVaultRowLock(t, ctx, pool)
	if _, err := resetTransaction.Exec(ctx, `DELETE FROM authenticator_accounts WHERE vault_id = $1`, vaultID); err != nil {
		t.Fatalf("delete synthetic Personal Vault accounts during reset: %v", err)
	}
	if _, err := resetTransaction.Exec(ctx, `
		UPDATE vaults SET lifecycle = 'UNINITIALIZED', encrypted_name = NULL, encryption_version = 1
		WHERE id = $1`, vaultID); err != nil {
		t.Fatalf("mark synthetic Personal Vault uninitialized: %v", err)
	}
	if err := resetTransaction.Commit(ctx); err != nil {
		t.Fatalf("commit synthetic Personal Vault reset: %v", err)
	}
	if err := <-createResult; err == nil || !strings.Contains(err.Error(), "Personal Vault is unavailable") {
		t.Fatalf("concurrent Personal Account create error=%v; want unavailable after reset", err)
	}
	var accountCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM authenticator_accounts WHERE vault_id = $1`, vaultID).Scan(&accountCount); err != nil || accountCount != 0 {
		t.Fatalf("Personal Account count after reset/create race=%d err=%v; want zero", accountCount, err)
	}
}

func waitForPersonalVaultRowLock(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		var blocked bool
		if err := pool.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM pg_stat_activity
				WHERE wait_event_type = 'Lock'
				  AND query LIKE '%SELECT encryption_version%'
				  AND query LIKE '%FOR UPDATE%'
			)`).Scan(&blocked); err != nil {
			t.Fatalf("check blocked Personal Vault row lock: %v", err)
		}
		if blocked {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("concurrent Personal Account creation did not wait on the Personal Vault row lock")
}

func TestPersonalAccountRepositoryRejectsCrossOwnerAndCrossVaultTargets(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	firstOwnerID, firstVaultID := createActiveSyntheticPersonalVault(t, ctx, pool, now)
	secondOwnerID, secondVaultID := createActiveSyntheticPersonalVault(t, ctx, pool, now)
	repository, err := NewPersonalAccountRepository(pool, func() time.Time { return now })
	if err != nil {
		t.Fatalf("create Personal Account repository: %v", err)
	}

	firstPayload := syntheticPersonalAccountEnvelope(1, 64)
	defer clear(firstPayload)
	firstAccount, err := repository.Create(ctx, firstOwnerID, firstVaultID, apiService.NewEncryptedAccount{
		EncryptedPayload: firstPayload, EncryptionVersion: 1,
	})
	if err != nil {
		t.Fatalf("create first synthetic account: %v", err)
	}
	defer firstAccount.Clear()

	secondPayload := syntheticPersonalAccountEnvelope(1, 65)
	defer clear(secondPayload)
	secondAccount, err := repository.Create(ctx, secondOwnerID, secondVaultID, apiService.NewEncryptedAccount{
		EncryptedPayload: secondPayload, EncryptionVersion: 1,
	})
	if err != nil {
		t.Fatalf("create second synthetic account: %v", err)
	}
	defer secondAccount.Clear()

	if _, err := repository.List(ctx, secondOwnerID, firstVaultID); err == nil {
		t.Fatal("foreign owner listed another actor's Personal Vault accounts")
	}
	if _, err := repository.List(ctx, firstOwnerID, secondVaultID); err == nil {
		t.Fatal("owner listed accounts through another actor's Personal Vault ID")
	}
	if _, err := repository.Create(ctx, secondOwnerID, firstVaultID, apiService.NewEncryptedAccount{
		EncryptedPayload: syntheticPersonalAccountEnvelope(1, 66), EncryptionVersion: 1,
	}); err == nil {
		t.Fatal("foreign owner created an account in another actor's Personal Vault")
	}
	if _, err := repository.Delete(ctx, secondOwnerID, firstVaultID, firstAccount.ID, firstAccount.Revision); err == nil {
		t.Fatal("foreign owner deleted an account in another actor's Personal Vault")
	}

	updated, err := repository.Update(ctx, firstOwnerID, firstVaultID, secondAccount.ID, secondAccount.Revision, apiService.NewEncryptedAccount{
		EncryptedPayload: syntheticPersonalAccountEnvelope(1, 67), EncryptionVersion: 1,
	})
	if err != nil || updated != nil {
		if updated != nil {
			updated.Clear()
		}
		t.Fatalf("cross-Vault account update=%#v err=%v; want no result and no error", updated, err)
	}

	replacement := syntheticPersonalAccountEnvelope(2, 68)
	defer clear(replacement)
	migration := userEncryptedPayloadMigration(secondPayload, replacement, sharedapp.SHA256Base64URL(replacement))
	migrationResult, err := repository.MigratePayload(ctx, firstOwnerID, firstVaultID, secondAccount.ID, 1, 1, migration)
	if err != nil || migrationResult != sharedapp.EncryptedPayloadMigrationConflict {
		t.Fatalf("cross-Vault account migration=%q err=%v; want conflict", migrationResult, err)
	}

	deleted, err := repository.Delete(ctx, firstOwnerID, firstVaultID, secondAccount.ID, secondAccount.Revision)
	if err != nil || deleted {
		t.Fatalf("cross-Vault account deletion=%v err=%v; want false", deleted, err)
	}
	deleted, err = repository.Delete(ctx, secondOwnerID, secondVaultID, secondAccount.ID, secondAccount.Revision)
	if err != nil || !deleted {
		t.Fatalf("delete second actor's account for restore check: deleted=%v err=%v", deleted, err)
	}
	restored, err := repository.Restore(ctx, firstOwnerID, secondVaultID, secondAccount.ID)
	if err == nil || restored {
		t.Fatalf("foreign owner restore=%v err=%v; want unavailable error and no restore", restored, err)
	}
	var secondAccountStillDeleted bool
	if err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM authenticator_accounts
			WHERE id = $1 AND vault_id = $2 AND deleted_at IS NOT NULL
		)`, secondAccount.ID, secondVaultID).Scan(&secondAccountStillDeleted); err != nil || !secondAccountStillDeleted {
		t.Fatalf("foreign Restore changed the real owner's account deletion state=%v err=%v", secondAccountStillDeleted, err)
	}
	restored, err = repository.Restore(ctx, firstOwnerID, firstVaultID, secondAccount.ID)
	if err != nil || restored {
		t.Fatalf("cross-Vault account restore=%v err=%v; want false", restored, err)
	}

	listed, err := repository.List(ctx, firstOwnerID, firstVaultID)
	if err != nil || len(listed) != 1 || listed[0].ID != firstAccount.ID {
		clearPersonalAccounts(listed)
		t.Fatalf("first actor's accounts after foreign mutations=%#v err=%v", listed, err)
	}
	clearPersonalAccounts(listed)
}

func TestPersonalAccountRepositoryIntegration(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	ownerID, vaultID := createActiveSyntheticPersonalVault(t, ctx, pool, now)
	repository, err := NewPersonalAccountRepository(pool, func() time.Time { return now })
	if err != nil {
		t.Fatalf("create Personal Account repository: %v", err)
	}

	t.Run("persists opaque account payload and local-copy audit atomically", func(t *testing.T) {
		payload := syntheticPersonalAccountEnvelope(1, 64)
		account, err := repository.Create(ctx, ownerID, vaultID, apiService.NewEncryptedAccount{
			EncryptedPayload: payload, EncryptionVersion: 1, Source: apiService.AccountCopySourceLocalVault,
		})
		if err != nil {
			t.Fatalf("create copied Personal Vault account: %v", err)
		}
		defer account.Clear()
		if account.ID == "" || account.VaultID != vaultID || account.EncryptionVersion != 1 || account.Revision != 1 || string(account.EncryptedPayload) != string(payload) {
			t.Fatalf("unexpected created Personal Account: %#v", account)
		}
		var eventType string
		var targetID string
		if err := pool.QueryRow(ctx, `
			SELECT event_type, target_id FROM vault_audit_events
			WHERE vault_id = $1 AND actor_user_id = $2`, vaultID, ownerID).Scan(&eventType, &targetID); err != nil {
			t.Fatalf("read synthetic Local Vault copy audit event: %v", err)
		}
		if eventType != "ACCOUNT_COPIED_FROM_LOCAL" || targetID != account.ID {
			t.Fatal("Local Vault account copy did not append the expected redacted audit event")
		}
		var sensitiveFields int
		if err := pool.QueryRow(ctx, `
			SELECT count(*) FROM information_schema.columns
			WHERE table_name = 'vault_audit_events' AND column_name IN ('account_name', 'issuer', 'totp_secret', 'otp')`).Scan(&sensitiveFields); err != nil || sensitiveFields != 0 {
			t.Fatalf("audit table exposed prohibited account data fields: count=%d err=%v", sensitiveFields, err)
		}
	})

	t.Run("lists, updates, soft-deletes, and restores with revision and deadline rules", func(t *testing.T) {
		initial := syntheticPersonalAccountEnvelope(1, 64)
		account, err := repository.Create(ctx, ownerID, vaultID, apiService.NewEncryptedAccount{EncryptedPayload: initial, EncryptionVersion: 1})
		if err != nil {
			t.Fatalf("create synthetic Personal Account: %v", err)
		}
		defer account.Clear()
		var addedEvents int
		if err := pool.QueryRow(ctx, `
			SELECT count(*) FROM vault_audit_events WHERE vault_id = $1 AND target_id = $2 AND event_type = 'ACCOUNT_ADDED'`,
			vaultID, account.ID).Scan(&addedEvents); err != nil || addedEvents != 1 {
			t.Fatalf("Personal Account add audit count=%d err=%v; want one", addedEvents, err)
		}
		updatedPayload := syntheticPersonalAccountEnvelope(1, 65)
		updated, err := repository.Update(ctx, ownerID, vaultID, account.ID, 1, apiService.NewEncryptedAccount{
			EncryptedPayload: updatedPayload, EncryptionVersion: 1,
		})
		if err != nil || updated == nil {
			t.Fatalf("update Personal Account: account=%#v err=%v", updated, err)
		}
		defer updated.Clear()
		if updated.Revision != 2 || string(updated.EncryptedPayload) != string(updatedPayload) {
			t.Fatal("Personal Account update did not advance revision and replace ciphertext")
		}
		var updatedEvents int
		if err := pool.QueryRow(ctx, `
			SELECT count(*) FROM vault_audit_events WHERE vault_id = $1 AND target_id = $2 AND event_type = 'ACCOUNT_UPDATED'`,
			vaultID, account.ID).Scan(&updatedEvents); err != nil || updatedEvents != 1 {
			t.Fatalf("Personal Account update audit count=%d err=%v; want one", updatedEvents, err)
		}
		stalePayload := syntheticPersonalAccountEnvelope(1, 66)
		staleUpdate, staleErr := repository.Update(ctx, ownerID, vaultID, account.ID, 1, apiService.NewEncryptedAccount{
			EncryptedPayload: stalePayload, EncryptionVersion: 1,
		})
		clear(stalePayload)
		if staleErr != nil || staleUpdate != nil {
			t.Fatalf("stale Personal Account update=%#v err=%v; want no result and no error", staleUpdate, staleErr)
		}
		if err := pool.QueryRow(ctx, `
			SELECT count(*) FROM vault_audit_events WHERE vault_id = $1 AND target_id = $2 AND event_type = 'ACCOUNT_UPDATED'`,
			vaultID, account.ID).Scan(&updatedEvents); err != nil || updatedEvents != 1 {
			t.Fatalf("stale Personal Account update audit count=%d err=%v; want unchanged one", updatedEvents, err)
		}
		listed, err := repository.List(ctx, ownerID, vaultID)
		if err != nil {
			t.Fatalf("list synthetic Personal Accounts: %v", err)
		}
		if len(listed) != 2 {
			clearPersonalAccounts(listed)
			t.Fatalf("listed %d accounts, want both active synthetic accounts", len(listed))
		}
		clearPersonalAccounts(listed)

		deletedAt := now
		deleted, err := repository.Delete(ctx, ownerID, vaultID, account.ID, 2)
		if err != nil || !deleted {
			t.Fatalf("soft-delete Personal Account: deleted=%v err=%v", deleted, err)
		}
		var storedRevision int32
		var storedDeletedAt, storedPurgeAfter time.Time
		if err := pool.QueryRow(ctx, `
			SELECT revision, deleted_at, purge_after FROM authenticator_accounts WHERE id = $1`, account.ID).
			Scan(&storedRevision, &storedDeletedAt, &storedPurgeAfter); err != nil {
			t.Fatalf("read soft-deleted Personal Account: %v", err)
		}
		if storedRevision != 3 || !storedDeletedAt.Equal(deletedAt) || !storedPurgeAfter.Equal(deletedAt.Add(30*24*time.Hour)) {
			t.Fatal("soft-delete did not set revision and exact 30-day recovery deadline")
		}
		now = deletedAt.Add(30*24*time.Hour + time.Second)
		restored, err := repository.Restore(ctx, ownerID, vaultID, account.ID)
		if err != nil || restored {
			t.Fatalf("restored Personal Account after purge deadline: restored=%v err=%v", restored, err)
		}
	})

	t.Run("allows only one concurrent update for the same revision", func(t *testing.T) {
		original := syntheticPersonalAccountEnvelope(1, 64)
		account, err := repository.Create(ctx, ownerID, vaultID, apiService.NewEncryptedAccount{EncryptedPayload: original, EncryptionVersion: 1})
		if err != nil {
			t.Fatalf("create concurrent-update Personal Account: %v", err)
		}
		defer account.Clear()
		now = time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
		results := make(chan *accountRevisionResult, 2)
		var workers sync.WaitGroup
		workers.Add(2)
		for index := range 2 {
			go func(index int) {
				defer workers.Done()
				payload := syntheticPersonalAccountEnvelope(1, 65+index)
				updated, err := repository.Update(ctx, ownerID, vaultID, account.ID, 1, apiService.NewEncryptedAccount{
					EncryptedPayload: payload, EncryptionVersion: 1,
				})
				clear(payload)
				results <- &accountRevisionResult{account: updated, err: err}
			}(index)
		}
		workers.Wait()
		close(results)
		updatedCount, staleCount := 0, 0
		for result := range results {
			if result.err != nil {
				t.Fatalf("concurrent Personal Account update: %v", result.err)
			}
			if result.account == nil {
				staleCount++
				continue
			}
			updatedCount++
			if result.account.Revision != 2 {
				t.Fatalf("concurrent update revision=%d, want 2", result.account.Revision)
			}
			result.account.Clear()
		}
		if updatedCount != 1 || staleCount != 1 {
			t.Fatalf("concurrent update outcomes: success=%d stale=%d; want one each", updatedCount, staleCount)
		}
	})

	t.Run("migrates envelope idempotently without advancing account revision", func(t *testing.T) {
		original := syntheticPersonalAccountEnvelope(1, 64)
		account, err := repository.Create(ctx, ownerID, vaultID, apiService.NewEncryptedAccount{EncryptedPayload: original, EncryptionVersion: 1})
		if err != nil {
			t.Fatalf("create migration Personal Account: %v", err)
		}
		defer account.Clear()
		replacement := syntheticPersonalAccountEnvelope(2, 65)
		replacementDigest := sharedapp.SHA256Base64URL(replacement)
		migration := userEncryptedPayloadMigration(original, replacement, replacementDigest)
		result, err := repository.MigratePayload(ctx, ownerID, vaultID, account.ID, 1, 1, migration)
		if err != nil || result != "committed" {
			t.Fatalf("migrate Personal Account: result=%q err=%v", result, err)
		}
		result, err = repository.MigratePayload(ctx, ownerID, vaultID, account.ID, 1, 1, migration)
		if err != nil || result != "already-committed" {
			t.Fatalf("replay Personal Account migration: result=%q err=%v", result, err)
		}
		var storedPayload []byte
		var storedRevision int32
		if err := pool.QueryRow(ctx, `SELECT encrypted_payload, revision FROM authenticator_accounts WHERE id = $1`, account.ID).Scan(&storedPayload, &storedRevision); err != nil {
			t.Fatalf("read migrated Personal Account: %v", err)
		}
		defer clear(storedPayload)
		if storedRevision != 1 || string(storedPayload) != string(replacement) {
			t.Fatal("Personal Account migration changed revision or persisted unexpected ciphertext")
		}
	})
}

type accountRevisionResult struct {
	account *apiEntity.EncryptedAuthenticatorAccount
	err     error
}

func createActiveSyntheticPersonalVault(t *testing.T, ctx context.Context, pool *pgxpool.Pool, now time.Time) (string, string) {
	t.Helper()
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	vaultRepository, err := NewPersonalVaultRepository(pool, func() time.Time { return now })
	if err != nil {
		t.Fatalf("create synthetic Personal Vault repository: %v", err)
	}
	vault, err := vaultRepository.EnsureForOwner(ctx, ownerID)
	if err != nil {
		t.Fatalf("ensure synthetic Personal Vault: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM authenticator_accounts WHERE vault_id = $1`, vault.ID)
		_, _ = pool.Exec(ctx, `DELETE FROM vault_audit_events WHERE vault_id = $1`, vault.ID)
		_, _ = pool.Exec(ctx, `DELETE FROM vault_members WHERE vault_id = $1`, vault.ID)
		_, _ = pool.Exec(ctx, `DELETE FROM vaults WHERE id = $1`, vault.ID)
	})
	initializer, err := NewPersonalVaultInitializer(pool, func() time.Time { return now })
	if err != nil {
		t.Fatalf("create synthetic Personal Vault initializer: %v", err)
	}
	if err := initializer.Initialize(ctx, ownerID, apiService.PersonalVaultInitialization{
		VaultUnlockSalt:           make([]byte, 16),
		WrappedUserRootKey:        syntheticPersonalAccountEnvelope(1, 64),
		EncryptedPersonalVaultKey: syntheticPersonalAccountEnvelope(1, 65),
		EncryptedVaultName:        syntheticPersonalAccountEnvelope(1, 66),
		UserEncryptionPublicKey: apiService.UserEncryptionPublicKey{
			Kty: "EC", Crv: "P-256", X: strings.Repeat("A", 43), Y: strings.Repeat("B", 43),
		},
		EncryptedUserPrivateKey:  syntheticPersonalAccountEnvelope(1, 67),
		UserEncryptionKeyVersion: 1,
		EncryptionVersion:        1,
	}); err != nil {
		t.Fatalf("initialize synthetic Personal Vault: %v", err)
	}
	return ownerID, vault.ID
}

func syntheticPersonalAccountEnvelope(version byte, size int) []byte {
	payload := make([]byte, size)
	payload[0] = version
	for index := 1; index < len(payload); index++ {
		payload[index] = byte(index)
	}
	return payload
}

func userEncryptedPayloadMigration(original []byte, replacement []byte, operationID string) sharedapp.EncryptedPayloadMigration {
	return sharedapp.EncryptedPayloadMigration{
		ExpectedEnvelopeVersion:     1,
		ReplacementEnvelopeVersion:  2,
		ExpectedCiphertextDigest:    sharedapp.SHA256Base64URL(original),
		ReplacementCiphertextDigest: operationID,
		ReplacementCiphertext:       replacement,
		OperationID:                 operationID,
	}
}
