package repository

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

func TestPersonalVaultInitializerIntegration(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	initializer, err := NewPersonalVaultInitializer(pool, func() time.Time {
		return time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	})
	if err != nil {
		t.Fatalf("create Personal Vault initializer: %v", err)
	}

	t.Run("atomically persists encrypted identity profile and activates the Personal Vault", func(t *testing.T) {
		userID := testsupport.CreateSyntheticApplicationUser(t, pool)
		vaultID := insertSyntheticPersonalVault(t, pool, userID)
		initialization := syntheticPersonalVaultInitialization()
		if err := initializer.Initialize(ctx, userID, initialization); err != nil {
			t.Fatalf("initialize Personal Vault: %v", err)
		}
		assertSyntheticPersonalVaultState(t, ctx, pool, userID, vaultID, initialization)
		if err := initializer.Initialize(ctx, userID, initialization); err == nil {
			t.Fatal("repeated Personal Vault initialization succeeded")
		}
		assertSyntheticPersonalVaultState(t, ctx, pool, userID, vaultID, initialization)
	})

	t.Run("serializes concurrent initialization and commits only one profile", func(t *testing.T) {
		userID := testsupport.CreateSyntheticApplicationUser(t, pool)
		vaultID := insertSyntheticPersonalVault(t, pool, userID)
		initialization := syntheticPersonalVaultInitialization()
		results := make(chan error, 2)
		var workers sync.WaitGroup
		workers.Add(2)
		for range 2 {
			go func() {
				defer workers.Done()
				results <- initializer.Initialize(ctx, userID, initialization)
			}()
		}
		workers.Wait()
		close(results)
		committed := 0
		conflicts := 0
		for err := range results {
			if err == nil {
				committed++
				continue
			}
			conflicts++
		}
		if committed != 1 || conflicts != 1 {
			t.Fatalf("concurrent initialization outcomes: committed=%d conflicts=%d; want one of each", committed, conflicts)
		}
		assertSyntheticPersonalVaultState(t, ctx, pool, userID, vaultID, initialization)
	})
}

func syntheticVaultPublicKey() apiService.UserEncryptionPublicKey {
	return apiService.UserEncryptionPublicKey{Kty: "EC", Crv: "P-256", X: strings.Repeat("A", 43), Y: strings.Repeat("B", 43)}
}

func syntheticVaultEnvelope(version byte, length int) []byte {
	value := make([]byte, length)
	value[0] = version
	for index := 1; index < length; index++ {
		value[index] = byte(index)
	}
	return value
}

func insertSyntheticPersonalVault(t *testing.T, pool *pgxpool.Pool, ownerID string) string {
	t.Helper()
	vaultID, err := testsupport.NewSyntheticCUID()
	if err != nil {
		t.Fatalf("generate synthetic Personal Vault ID: %v", err)
	}
	now := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO vaults (id, type, lifecycle, owner_id, encryption_version, created_at, updated_at)
		VALUES ($1, 'PERSONAL', 'UNINITIALIZED', $2, 1, $3, $3)`, vaultID, ownerID, now); err != nil {
		t.Fatalf("insert synthetic Personal Vault: %v", err)
	}
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO vault_members (vault_id, user_id, role, status, created_at, updated_at)
		VALUES ($1, $2, 'OWNER', 'ACTIVE', $3, $3)`, vaultID, ownerID, now); err != nil {
		t.Fatalf("insert synthetic Personal Vault owner membership: %v", err)
	}
	registerSyntheticPersonalVaultCleanup(t, pool, vaultID)
	return vaultID
}

func registerSyntheticPersonalVaultCleanup(t *testing.T, pool *pgxpool.Pool, vaultID string) {
	t.Helper()
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM vault_members WHERE vault_id = $1`, vaultID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM vaults WHERE id = $1`, vaultID)
	})
}

func syntheticPersonalVaultInitialization() apiService.PersonalVaultInitialization {
	return apiService.PersonalVaultInitialization{
		VaultUnlockSalt:           make([]byte, 16),
		WrappedUserRootKey:        syntheticVaultEnvelope(1, 64),
		EncryptedPersonalVaultKey: syntheticVaultEnvelope(2, 65),
		EncryptedVaultName:        syntheticVaultEnvelope(1, 66),
		UserEncryptionPublicKey:   syntheticVaultPublicKey(),
		EncryptedUserPrivateKey:   syntheticVaultEnvelope(1, 67),
		UserEncryptionKeyVersion:  1,
		EncryptionVersion:         1,
	}
}

func assertSyntheticPersonalVaultState(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ownerID string, vaultID string, expected apiService.PersonalVaultInitialization) {
	t.Helper()
	var lifecycle string
	var encryptionVersion int
	var encryptedName []byte
	if err := pool.QueryRow(ctx, `SELECT lifecycle, encryption_version, encrypted_name FROM vaults WHERE id = $1`, vaultID).Scan(&lifecycle, &encryptionVersion, &encryptedName); err != nil {
		t.Fatalf("read synthetic Personal Vault state: %v", err)
	}
	if lifecycle != "ACTIVE" || encryptionVersion != 1 || string(encryptedName) != string(expected.EncryptedVaultName) {
		t.Fatal("Personal Vault lifecycle or encrypted name did not match the initialization")
	}
	var salt []byte
	var wrappedRoot []byte
	var rootVersion int
	var personalKey []byte
	var personalVersion int
	var rawPublicKey []byte
	var privateKey []byte
	var userEncryptionVersion int
	if err := pool.QueryRow(ctx, `
		SELECT vault_unlock_salt, wrapped_user_root_key, root_key_wrapping_version,
		       encrypted_personal_vault_key, personal_vault_key_encryption_version,
		       user_encryption_public_key, encrypted_user_private_key, user_encryption_key_version
		FROM user_crypto_profiles WHERE user_id = $1`, ownerID).Scan(
		&salt, &wrappedRoot, &rootVersion, &personalKey, &personalVersion, &rawPublicKey, &privateKey, &userEncryptionVersion,
	); err != nil {
		t.Fatalf("read initialized synthetic User Crypto Profile: %v", err)
	}
	storedPublicKey, err := apiService.ParseUserEncryptionPublicKey(rawPublicKey)
	if err != nil || storedPublicKey != expected.UserEncryptionPublicKey || string(salt) != string(expected.VaultUnlockSalt) ||
		string(wrappedRoot) != string(expected.WrappedUserRootKey) || rootVersion != 1 ||
		string(personalKey) != string(expected.EncryptedPersonalVaultKey) || personalVersion != 1 ||
		string(privateKey) != string(expected.EncryptedUserPrivateKey) || userEncryptionVersion != 1 {
		t.Fatal("User Crypto Profile did not match the initialized encrypted values")
	}
}
