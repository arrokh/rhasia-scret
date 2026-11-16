package repository

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

func TestPersonalVaultRepositoryEnsureForOwnerIntegration(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	repository, err := NewPersonalVaultRepository(pool, func() time.Time {
		return time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	})
	if err != nil {
		t.Fatalf("create Personal Vault repository: %v", err)
	}

	t.Run("creates one uninitialized Personal Vault and owner membership", func(t *testing.T) {
		ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
		first, err := repository.EnsureForOwner(context.Background(), ownerID)
		if err != nil {
			t.Fatalf("ensure Personal Vault: %v", err)
		}
		registerSyntheticPersonalVaultCleanup(t, pool, first.ID)
		second, err := repository.EnsureForOwner(context.Background(), ownerID)
		if err != nil {
			t.Fatalf("ensure existing Personal Vault: %v", err)
		}
		if first != second || first.Type != "PERSONAL" || first.Lifecycle != "UNINITIALIZED" || first.OwnerID != ownerID {
			t.Fatalf("unexpected ensured Personal Vault values: first=%#v second=%#v", first, second)
		}
		var vaultCount, ownerMembershipCount int
		if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM vaults WHERE owner_id = $1 AND type = 'PERSONAL'`, ownerID).Scan(&vaultCount); err != nil {
			t.Fatalf("count synthetic Personal Vaults: %v", err)
		}
		if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM vault_members WHERE vault_id = $1 AND user_id = $2 AND role = 'OWNER'`, first.ID, ownerID).Scan(&ownerMembershipCount); err != nil {
			t.Fatalf("count synthetic owner memberships: %v", err)
		}
		if vaultCount != 1 || ownerMembershipCount != 1 {
			t.Fatalf("ensure created vaults=%d owner memberships=%d; want one each", vaultCount, ownerMembershipCount)
		}
	})

	t.Run("serializes concurrent ensure calls", func(t *testing.T) {
		ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
		results := make(chan struct {
			vaultID string
			err     error
		}, 2)
		var workers sync.WaitGroup
		workers.Add(2)
		for range 2 {
			go func() {
				defer workers.Done()
				vault, err := repository.EnsureForOwner(context.Background(), ownerID)
				results <- struct {
					vaultID string
					err     error
				}{vaultID: vault.ID, err: err}
			}()
		}
		workers.Wait()
		close(results)
		vaultIDs := make(map[string]struct{})
		for result := range results {
			if result.err != nil {
				t.Fatalf("concurrent Personal Vault ensure: %v", result.err)
			}
			vaultIDs[result.vaultID] = struct{}{}
		}
		for vaultID := range vaultIDs {
			registerSyntheticPersonalVaultCleanup(t, pool, vaultID)
		}
		if len(vaultIDs) != 1 {
			t.Fatalf("concurrent ensure produced %d Personal Vault IDs", len(vaultIDs))
		}
	})
}

func TestPersonalVaultRepositoryMigrateNameIntegration(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := func() time.Time { return time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC) }
	repository, err := NewPersonalVaultRepository(pool, now)
	if err != nil {
		t.Fatalf("create Personal Vault repository: %v", err)
	}
	initializer, err := NewPersonalVaultInitializer(pool, now)
	if err != nil {
		t.Fatalf("create Personal Vault initializer: %v", err)
	}

	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	vaultID := insertSyntheticPersonalVault(t, pool, ownerID)
	initialization := syntheticPersonalVaultInitialization()
	if err := initializer.Initialize(ctx, ownerID, initialization); err != nil {
		t.Fatalf("initialize synthetic Personal Vault for name migration: %v", err)
	}
	replacement := syntheticVaultEnvelope(2, 67)
	migration := syntheticPersonalVaultMigration(initialization.EncryptedVaultName, replacement)
	result, err := repository.MigrateName(ctx, ownerID, vaultID, 1, migration)
	if err != nil || result != sharedapp.EncryptedPayloadMigrationCommitted {
		t.Fatalf("migrate Personal Vault name: result=%q err=%v", result, err)
	}
	assertSyntheticPersonalVaultName(t, ctx, pool, vaultID, replacement)

	result, err = repository.MigrateName(ctx, ownerID, vaultID, 1, migration)
	if err != nil || result != sharedapp.EncryptedPayloadMigrationAlreadyCommitted {
		t.Fatalf("replay Personal Vault name migration: result=%q err=%v", result, err)
	}

	wrongSource := syntheticVaultEnvelope(1, 63)
	conflictingReplacement := syntheticVaultEnvelope(2, 68)
	conflict := syntheticPersonalVaultMigration(wrongSource, conflictingReplacement)
	result, err = repository.MigrateName(ctx, ownerID, vaultID, 1, conflict)
	if err != nil || result != sharedapp.EncryptedPayloadMigrationConflict {
		t.Fatalf("conflicting Personal Vault name migration: result=%q err=%v", result, err)
	}
	result, err = repository.MigrateName(ctx, "different-synthetic-owner", vaultID, 1, migration)
	if err != nil || result != sharedapp.EncryptedPayloadMigrationConflict {
		t.Fatalf("non-owner Personal Vault name migration: result=%q err=%v", result, err)
	}
	assertSyntheticPersonalVaultName(t, ctx, pool, vaultID, replacement)
}

func syntheticPersonalVaultMigration(expected []byte, replacement []byte) sharedapp.EncryptedPayloadMigration {
	replacementDigest := sharedapp.SHA256Base64URL(replacement)
	return sharedapp.EncryptedPayloadMigration{
		ExpectedEnvelopeVersion:     1,
		ReplacementEnvelopeVersion:  2,
		ExpectedCiphertextDigest:    sharedapp.SHA256Base64URL(expected),
		ReplacementCiphertextDigest: replacementDigest,
		ReplacementCiphertext:       replacement,
		OperationID:                 replacementDigest,
	}
}

func assertSyntheticPersonalVaultName(t *testing.T, ctx context.Context, pool *pgxpool.Pool, vaultID string, expected []byte) {
	t.Helper()
	var actual []byte
	if err := pool.QueryRow(ctx, `SELECT encrypted_name FROM vaults WHERE id = $1`, vaultID).Scan(&actual); err != nil {
		t.Fatalf("read synthetic encrypted Personal Vault name: %v", err)
	}
	defer clear(actual)
	if string(actual) != string(expected) {
		t.Fatal("encrypted Personal Vault name did not match the expected ciphertext")
	}
}
