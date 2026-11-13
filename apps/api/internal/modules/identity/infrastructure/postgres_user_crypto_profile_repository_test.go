package infrastructure

import (
	"context"
	"encoding/json"
	"reflect"
	"sort"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity/application"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

func TestProfileWrapperMigrationState(t *testing.T) {
	oldValue := append([]byte{1}, make([]byte, 63)...)
	newValue := append([]byte{2}, make([]byte, 63)...)
	migration := &identityapp.UserCryptoProfileWrapperMigration{ExpectedCiphertext: oldValue, ReplacementCiphertext: newValue}
	tests := []struct {
		name      string
		current   []byte
		migration *identityapp.UserCryptoProfileWrapperMigration
		want      profileMigrationState
	}{
		{name: "expected source", current: oldValue, migration: migration, want: profileMigrationReplace},
		{name: "replacement already committed", current: newValue, migration: migration, want: profileMigrationAlreadyCommitted},
		{name: "stale source conflicts", current: []byte("synthetic-stale-envelope"), migration: migration, want: profileMigrationConflict},
		{name: "omitted migration", current: oldValue, want: profileMigrationNone},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := profileWrapperMigrationState(test.current, test.migration); got != test.want {
				t.Fatalf("migration state = %d; want %d", got, test.want)
			}
		})
	}
}

func TestPostgresUserCryptoProfileRepositoryIntegration(t *testing.T) {
	pool := newGoIntegrationPool(t)
	ctx := context.Background()
	repository, err := NewPostgresUserCryptoProfileRepository(pool, func() time.Time {
		return time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	})
	if err != nil {
		t.Fatalf("create user crypto profile repository: %v", err)
	}
	userID := createSyntheticProfileUser(t, pool)
	initial := syntheticProfile()
	insertSyntheticCryptoProfile(t, pool, userID, initial)

	t.Run("reads encrypted profile bytes and public key without a user identity projection", func(t *testing.T) {
		profile, err := repository.Get(ctx, userID)
		if err != nil {
			t.Fatalf("read crypto profile: %v", err)
		}
		if profile == nil || string(profile.VaultUnlockSalt) != string(initial.VaultUnlockSalt) ||
			string(profile.WrappedUserRootKey) != string(initial.WrappedUserRootKey) ||
			string(profile.EncryptedPersonalVaultKey) != string(initial.EncryptedPersonalVaultKey) || profile.EncryptionVersion != 1 ||
			!sameJSONValue(profile.UserEncryptionPublicKey, initial.UserEncryptionPublicKey) || profile.EncryptedUserPrivateKey != nil {
			t.Fatal("encrypted profile projection did not preserve the stored values")
		}
		missing, err := repository.Get(ctx, "c00000000syntheticmissingid")
		if err != nil || missing != nil {
			t.Fatalf("missing profile = %#v, %v; want nil", missing, err)
		}
		if _, err := pool.Exec(ctx, `UPDATE user_crypto_profiles SET user_encryption_public_key = NULL WHERE user_id = $1`, userID); err != nil {
			t.Fatalf("clear optional public key fixture: %v", err)
		}
		profile, err = repository.Get(ctx, userID)
		if err != nil || profile == nil || profile.UserEncryptionPublicKey != nil {
			t.Fatalf("SQL-null public key was not omitted (err=%v)", err)
		}
	})

	t.Run("rewrap atomically updates supplied encrypted values only", func(t *testing.T) {
		rewrappedSalt := make([]byte, 16)
		rewrappedRoot := syntheticEnvelope(1, 68)
		if err := repository.RewrapUserRootKey(ctx, userID, identityapp.UserRootKeyRewrap{
			VaultUnlockSalt: rewrappedSalt, WrappedUserRootKey: rewrappedRoot, EncryptionVersion: 1,
		}); err != nil {
			t.Fatalf("rewrap only user root key: %v", err)
		}
		profile, err := repository.Get(ctx, userID)
		if err != nil || profile == nil || string(profile.VaultUnlockSalt) != string(rewrappedSalt) ||
			string(profile.WrappedUserRootKey) != string(rewrappedRoot) ||
			string(profile.EncryptedPersonalVaultKey) != string(initial.EncryptedPersonalVaultKey) {
			t.Fatalf("partial rewrap changed unexpected fields (err=%v)", err)
		}
		personalKey := syntheticEnvelope(1, 69)
		if err := repository.RewrapUserRootKey(ctx, userID, identityapp.UserRootKeyRewrap{
			VaultUnlockSalt: rewrappedSalt, WrappedUserRootKey: rewrappedRoot,
			EncryptedPersonalVaultKey: personalKey, EncryptionVersion: 1,
		}); err != nil {
			t.Fatalf("rewrap personal vault key: %v", err)
		}
		profile, err = repository.Get(ctx, userID)
		if err != nil || profile == nil || string(profile.EncryptedPersonalVaultKey) != string(personalKey) {
			t.Fatalf("personal key rewrap did not persist (err=%v)", err)
		}
	})

	t.Run("migrates wrappers atomically and recognizes replay", func(t *testing.T) {
		secondUserID := createSyntheticProfileUser(t, pool)
		startProfile := syntheticProfile()
		insertSyntheticCryptoProfile(t, pool, secondUserID, startProfile)
		migration := syntheticProfileMigration(startProfile)
		result, err := repository.MigrateUserCryptoProfile(ctx, secondUserID, migration)
		if err != nil || result != identityapp.UserCryptoProfileMigrationCommitted {
			t.Fatalf("migrate profile = %q, %v; want committed", result, err)
		}
		result, err = repository.MigrateUserCryptoProfile(ctx, secondUserID, migration)
		if err != nil || result != identityapp.UserCryptoProfileMigrationAlreadyCommitted {
			t.Fatalf("replay profile migration = %q, %v; want already committed", result, err)
		}
		profile, err := repository.Get(ctx, secondUserID)
		if err != nil || profile == nil ||
			string(profile.WrappedUserRootKey) != string(migration.WrappedUserRootKey.ReplacementCiphertext) ||
			string(profile.EncryptedPersonalVaultKey) != string(migration.EncryptedPersonalVaultKey.ReplacementCiphertext) {
			t.Fatalf("profile migration did not persist (err=%v)", err)
		}
	})

	t.Run("keeps both wrappers unchanged when either source is stale", func(t *testing.T) {
		thirdUserID := createSyntheticProfileUser(t, pool)
		startProfile := syntheticProfile()
		insertSyntheticCryptoProfile(t, pool, thirdUserID, startProfile)
		migration := syntheticProfileMigration(startProfile)
		migration.EncryptedPersonalVaultKey.ExpectedCiphertext = syntheticEnvelope(1, 70)
		result, err := repository.MigrateUserCryptoProfile(ctx, thirdUserID, migration)
		if err != nil || result != identityapp.UserCryptoProfileMigrationConflict {
			t.Fatalf("stale profile migration = %q, %v; want conflict", result, err)
		}
		profile, err := repository.Get(ctx, thirdUserID)
		if err != nil || profile == nil ||
			string(profile.WrappedUserRootKey) != string(startProfile.WrappedUserRootKey) ||
			string(profile.EncryptedPersonalVaultKey) != string(startProfile.EncryptedPersonalVaultKey) {
			t.Fatalf("stale profile migration changed stored values (err=%v)", err)
		}
	})

	t.Run("serializes concurrent identical migrations", func(t *testing.T) {
		fourthUserID := createSyntheticProfileUser(t, pool)
		startProfile := syntheticProfile()
		insertSyntheticCryptoProfile(t, pool, fourthUserID, startProfile)
		migration := syntheticProfileMigration(startProfile)
		results := make(chan identityapp.UserCryptoProfileMigrationResult, 2)
		errors := make(chan error, 2)
		for range 2 {
			go func() {
				result, err := repository.MigrateUserCryptoProfile(ctx, fourthUserID, migration)
				results <- result
				errors <- err
			}()
		}
		outcomes := []identityapp.UserCryptoProfileMigrationResult{<-results, <-results}
		for range 2 {
			if err := <-errors; err != nil {
				t.Fatalf("concurrent migration: %v", err)
			}
		}
		sort.Slice(outcomes, func(i, j int) bool { return outcomes[i] < outcomes[j] })
		want := []identityapp.UserCryptoProfileMigrationResult{
			identityapp.UserCryptoProfileMigrationAlreadyCommitted,
			identityapp.UserCryptoProfileMigrationCommitted,
		}
		if outcomes[0] != want[0] || outcomes[1] != want[1] {
			t.Fatalf("concurrent migration outcomes = %#v; want %#v", outcomes, want)
		}
	})
}

func newGoIntegrationPool(t *testing.T) *pgxpool.Pool {
	return testsupport.NewDisposablePostgresPool(t)
}

func createSyntheticProfileUser(t *testing.T, pool *pgxpool.Pool) string {
	return testsupport.CreateSyntheticApplicationUser(t, pool)
}

func syntheticProfile() identityapp.EncryptedUserCryptoProfile {
	return identityapp.EncryptedUserCryptoProfile{
		VaultUnlockSalt:           make([]byte, 16),
		WrappedUserRootKey:        syntheticEnvelope(1, 64),
		EncryptedPersonalVaultKey: syntheticEnvelope(1, 65),
		EncryptionVersion:         1,
		UserEncryptionPublicKey:   json.RawMessage(`{"kty":"EC","crv":"P-256","x":"synthetic-x","y":"synthetic-y"}`),
	}
}

func insertSyntheticCryptoProfile(t *testing.T, pool *pgxpool.Pool, userID string, profile identityapp.EncryptedUserCryptoProfile) {
	t.Helper()
	now := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO user_crypto_profiles (
			user_id, vault_unlock_salt, wrapped_user_root_key, root_key_wrapping_version,
			encrypted_personal_vault_key, personal_vault_key_encryption_version,
			user_encryption_public_key, encrypted_user_private_key, user_encryption_key_version,
			created_at, updated_at
		)
		VALUES ($1, $2, $3, 1, $4, 1, $5, NULL, NULL, $6, $6)`,
		userID, profile.VaultUnlockSalt, profile.WrappedUserRootKey, profile.EncryptedPersonalVaultKey, []byte(profile.UserEncryptionPublicKey), now); err != nil {
		t.Fatalf("insert synthetic crypto profile: %v", err)
	}
}

func sameJSONValue(left []byte, right []byte) bool {
	var leftValue any
	var rightValue any
	if json.Unmarshal(left, &leftValue) != nil || json.Unmarshal(right, &rightValue) != nil {
		return false
	}
	return reflect.DeepEqual(leftValue, rightValue)
}

func syntheticProfileMigration(profile identityapp.EncryptedUserCryptoProfile) identityapp.UserCryptoProfileMigration {
	return identityapp.UserCryptoProfileMigration{
		WrappedUserRootKey: &identityapp.UserCryptoProfileWrapperMigration{
			ExpectedCiphertext: profile.WrappedUserRootKey, ReplacementCiphertext: syntheticEnvelope(2, 68),
		},
		EncryptedPersonalVaultKey: &identityapp.UserCryptoProfileWrapperMigration{
			ExpectedCiphertext: profile.EncryptedPersonalVaultKey, ReplacementCiphertext: syntheticEnvelope(2, 69),
		},
	}
}

func syntheticEnvelope(version byte, length int) []byte {
	value := make([]byte, length)
	value[0] = version
	for index := 1; index < length; index++ {
		value[index] = byte(index)
	}
	return value
}
