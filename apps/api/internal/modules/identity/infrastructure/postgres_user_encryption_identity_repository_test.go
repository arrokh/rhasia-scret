package infrastructure

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"sync"
	"testing"

	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity/application"
)

func TestPostgresUserEncryptionIdentityRepositoryIntegration(t *testing.T) {
	pool := newGoIntegrationPool(t)
	ctx := context.Background()
	repository, err := NewPostgresUserCryptoProfileRepository(pool, nil)
	if err != nil {
		t.Fatalf("create user crypto profile repository: %v", err)
	}

	t.Run("registers the public identity once and rejects missing profiles", func(t *testing.T) {
		userID := createSyntheticProfileUser(t, pool)
		profile := syntheticProfile()
		profile.UserEncryptionPublicKey = nil
		insertSyntheticCryptoProfile(t, pool, userID, profile)
		identity := identityapp.UserEncryptionIdentity{
			PublicKey: syntheticEncryptionPublicKey(), EncryptedPrivateKey: syntheticEnvelope(1, 64), EncryptionVersion: 1,
		}
		registered, err := repository.Register(ctx, userID, identity)
		if err != nil || !registered {
			t.Fatalf("register identity = %v, %v; want registered", registered, err)
		}
		registered, err = repository.Register(ctx, userID, identity)
		if err != nil || registered {
			t.Fatalf("register duplicate identity = %v, %v; want conflict", registered, err)
		}
		profileFromDB, err := repository.Get(ctx, userID)
		if err != nil || profileFromDB == nil || profileFromDB.EncryptionVersion != 1 ||
			string(profileFromDB.EncryptedUserPrivateKey) != string(identity.EncryptedPrivateKey) {
			t.Fatalf("registered identity profile did not match the submitted encrypted fields (err=%v)", err)
		}
		parsed, err := identityapp.ParseUserEncryptionPublicKey(profileFromDB.UserEncryptionPublicKey)
		if err != nil || parsed != identity.PublicKey {
			t.Fatalf("registered public identity = %#v, %v", parsed, err)
		}
		if _, err := repository.Register(ctx, "c00000000syntheticmissingid", identity); err == nil {
			t.Fatal("registering an identity without a crypto profile succeeded")
		}
	})

	t.Run("migrates a private-key envelope idempotently and preserves stale sources", func(t *testing.T) {
		userID := createSyntheticProfileUser(t, pool)
		profile := syntheticProfile()
		insertSyntheticCryptoProfile(t, pool, userID, profile)
		legacy := syntheticEnvelope(1, 64)
		replacement := syntheticEnvelope(2, 64)
		if _, err := pool.Exec(ctx, `UPDATE user_crypto_profiles SET encrypted_user_private_key = $2, user_encryption_key_version = 1 WHERE user_id = $1`, userID, legacy); err != nil {
			t.Fatalf("set synthetic legacy private-key envelope: %v", err)
		}
		migration := syntheticPrivateKeyMigration(legacy, replacement)
		result, err := repository.MigratePrivateKey(ctx, userID, migration)
		if err != nil || result != identityapp.UserEncryptionPrivateKeyMigrationCommitted {
			t.Fatalf("migrate private-key envelope = %q, %v; want committed", result, err)
		}
		result, err = repository.MigratePrivateKey(ctx, userID, migration)
		if err != nil || result != identityapp.UserEncryptionPrivateKeyMigrationAlreadyCommitted {
			t.Fatalf("replay private-key migration = %q, %v; want already committed", result, err)
		}
		staleUserID := createSyntheticProfileUser(t, pool)
		staleProfile := syntheticProfile()
		insertSyntheticCryptoProfile(t, pool, staleUserID, staleProfile)
		if _, err := pool.Exec(ctx, `UPDATE user_crypto_profiles SET encrypted_user_private_key = $2, user_encryption_key_version = 1 WHERE user_id = $1`, staleUserID, legacy); err != nil {
			t.Fatalf("set second synthetic legacy private-key envelope: %v", err)
		}
		staleMigration := syntheticPrivateKeyMigration(legacy, replacement)
		staleMigration.ExpectedCiphertextDigest = syntheticCiphertextDigest(syntheticEnvelope(1, 65))
		result, err = repository.MigratePrivateKey(ctx, staleUserID, staleMigration)
		if err != nil || result != identityapp.UserEncryptionPrivateKeyMigrationConflict {
			t.Fatalf("stale private-key migration = %q, %v; want conflict", result, err)
		}
		var preserved []byte
		if err := pool.QueryRow(ctx, `SELECT encrypted_user_private_key FROM user_crypto_profiles WHERE user_id = $1`, staleUserID).Scan(&preserved); err != nil {
			t.Fatalf("read stale source after conflict: %v", err)
		}
		if string(preserved) != string(legacy) {
			t.Fatal("stale private-key migration changed the original ciphertext")
		}
	})

	t.Run("serializes concurrent identical private-key migrations", func(t *testing.T) {
		userID := createSyntheticProfileUser(t, pool)
		profile := syntheticProfile()
		insertSyntheticCryptoProfile(t, pool, userID, profile)
		legacy := syntheticEnvelope(1, 64)
		replacement := syntheticEnvelope(2, 64)
		if _, err := pool.Exec(ctx, `UPDATE user_crypto_profiles SET encrypted_user_private_key = $2, user_encryption_key_version = 1 WHERE user_id = $1`, userID, legacy); err != nil {
			t.Fatalf("set synthetic legacy private-key envelope: %v", err)
		}
		migration := syntheticPrivateKeyMigration(legacy, replacement)
		var workers sync.WaitGroup
		results := make(chan identityapp.UserEncryptionPrivateKeyMigrationResult, 2)
		errors := make(chan error, 2)
		workers.Add(2)
		for range 2 {
			go func() {
				defer workers.Done()
				result, err := repository.MigratePrivateKey(ctx, userID, migration)
				results <- result
				errors <- err
			}()
		}
		workers.Wait()
		close(results)
		close(errors)
		committed := 0
		alreadyCommitted := 0
		for result := range results {
			switch result {
			case identityapp.UserEncryptionPrivateKeyMigrationCommitted:
				committed++
			case identityapp.UserEncryptionPrivateKeyMigrationAlreadyCommitted:
				alreadyCommitted++
			default:
				t.Fatalf("unexpected concurrent migration result: %q", result)
			}
		}
		for err := range errors {
			if err != nil {
				t.Fatalf("concurrent private-key migration: %v", err)
			}
		}
		if committed != 1 || alreadyCommitted != 1 {
			t.Fatalf("concurrent migration outcomes = committed:%d already:%d; want one of each", committed, alreadyCommitted)
		}
	})
}

func syntheticEncryptionPublicKey() identityapp.UserEncryptionPublicKey {
	return identityapp.UserEncryptionPublicKey{Kty: "EC", Crv: "P-256", X: repeatedCoordinate('A'), Y: repeatedCoordinate('B')}
}

func repeatedCoordinate(character byte) string {
	value := make([]byte, 43)
	for index := range value {
		value[index] = character
	}
	return string(value)
}

func syntheticPrivateKeyMigration(expected []byte, replacement []byte) identityapp.UserEncryptionPrivateKeyMigration {
	return identityapp.UserEncryptionPrivateKeyMigration{
		ExpectedEnvelopeVersion:     1,
		ReplacementEnvelopeVersion:  2,
		UserEncryptionKeyVersion:    1,
		ExpectedCiphertextDigest:    syntheticCiphertextDigest(expected),
		ReplacementCiphertextDigest: syntheticCiphertextDigest(replacement),
		EncryptedPrivateKey:         replacement,
		OperationID:                 syntheticCiphertextDigest(replacement),
	}
}

func syntheticCiphertextDigest(value []byte) string {
	digest := sha256.Sum256(value)
	return base64.RawURLEncoding.EncodeToString(digest[:])
}
