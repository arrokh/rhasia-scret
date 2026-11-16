package repository

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/postgres"
	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
)

func TestUserEncryptionIdentityRotationRepositoryIntegration(t *testing.T) {
	pool := newGoIntegrationPool(t)
	ctx := context.Background()
	repository, err := NewUserEncryptionIdentityRotationRepository(pool, func() time.Time {
		return time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	})
	if err != nil {
		t.Fatalf("create identity rotation repository: %v", err)
	}

	t.Run("snapshots only the active shared memberships", func(t *testing.T) {
		userID := createSyntheticProfileUser(t, pool)
		publicKey := syntheticEncryptionPublicKey()
		privateKey := syntheticEnvelope(1, 64)
		insertSyntheticIdentityProfile(t, pool, userID, publicKey, privateKey)
		activeVaultID := insertSyntheticRotationMembership(t, pool, userID, "SHARED", "ACTIVE", "ACTIVE", 3, syntheticEnvelope(1, 64))
		insertSyntheticRotationMembership(t, pool, userID, "SHARED", "ARCHIVED", "ACTIVE", 4, syntheticEnvelope(1, 64))
		insertSyntheticRotationMembership(t, pool, userID, "SHARED", "ACTIVE", "REVOKED", 5, syntheticEnvelope(1, 64))

		snapshot, err := repository.Snapshot(ctx, userID)
		if err != nil || snapshot == nil {
			t.Fatalf("identity snapshot was unavailable (err=%v)", err)
		}
		parsedKey, err := apiService.ParseUserEncryptionPublicKey(snapshot.PublicKey)
		if err != nil || parsedKey != publicKey || string(snapshot.EncryptedPrivateKey) != string(privateKey) || snapshot.EncryptionVersion != 1 {
			t.Fatalf("unexpected identity snapshot: %#v key=%#v err=%v", snapshot, parsedKey, err)
		}
		if len(snapshot.Memberships) != 1 || snapshot.Memberships[0].VaultID != activeVaultID ||
			snapshot.Memberships[0].KeyVersion != 3 || string(snapshot.Memberships[0].EncryptedVaultKey) != string(syntheticEnvelope(1, 64)) {
			t.Fatalf("snapshot included inactive or malformed Shared Vault memberships: %#v", snapshot.Memberships)
		}
		missing, err := repository.Snapshot(ctx, "c00000000syntheticmissingid")
		if err != nil || missing != nil {
			t.Fatalf("missing identity snapshot = %#v, %v; want nil", missing, err)
		}
	})

	t.Run("atomically rotates identity and active membership wraps with audit events", func(t *testing.T) {
		userID := createSyntheticProfileUser(t, pool)
		currentPublicKey := syntheticEncryptionPublicKey()
		replacementPublicKey := currentPublicKey
		replacementPublicKey.X = repeatedCoordinate('C')
		currentPrivateKey := syntheticEnvelope(1, 64)
		replacementPrivateKey := syntheticEnvelope(1, 65)
		insertSyntheticIdentityProfile(t, pool, userID, currentPublicKey, currentPrivateKey)
		vaultID := insertSyntheticRotationMembership(t, pool, userID, "SHARED", "ACTIVE", "ACTIVE", 3, syntheticEnvelope(1, 64))
		oldVaultKey := syntheticEnvelope(1, 64)
		newVaultKey := syntheticEnvelope(1, 65)
		if _, err := pool.Exec(ctx, `UPDATE vault_members SET encrypted_vault_key = $3 WHERE vault_id = $1 AND user_id = $2`, vaultID, userID, oldVaultKey); err != nil {
			t.Fatalf("set rotation source membership key: %v", err)
		}
		rotation := syntheticIdentityRotation(currentPublicKey, replacementPublicKey, currentPrivateKey, replacementPrivateKey, []apiService.UserEncryptionIdentityRotationMembership{{
			VaultID: vaultID, ExpectedKeyVersion: 3, ExpectedVaultKey: oldVaultKey, ReplacementVaultKey: newVaultKey,
		}})

		staleMembershipSet := rotation
		staleMembershipSet.Memberships = nil
		rotated, err := repository.Rotate(ctx, userID, staleMembershipSet)
		if err != nil || rotated {
			t.Fatalf("rotation with stale membership set = %v, %v; want conflict", rotated, err)
		}
		assertSyntheticIdentityState(t, ctx, pool, userID, currentPublicKey, currentPrivateKey, vaultID, oldVaultKey, 3)

		rotated, err = repository.Rotate(ctx, userID, rotation)
		if err != nil || !rotated {
			t.Fatalf("rotate user encryption identity = %v, %v; want committed", rotated, err)
		}
		assertSyntheticIdentityState(t, ctx, pool, userID, replacementPublicKey, replacementPrivateKey, vaultID, newVaultKey, 3)
		var auditCount int
		var eventType string
		var actorID string
		if err := pool.QueryRow(ctx, `SELECT count(*), min(event_type), min(actor_user_id) FROM vault_audit_events WHERE vault_id = $1`, vaultID).Scan(&auditCount, &eventType, &actorID); err != nil {
			t.Fatalf("read identity rotation audit event: %v", err)
		}
		if auditCount != 1 || eventType != "USER_ENCRYPTION_KEY_PAIR_ROTATED" || actorID != userID {
			t.Fatalf("identity rotation audit count=%d type=%q actor=%q", auditCount, eventType, actorID)
		}
		rotated, err = repository.Rotate(ctx, userID, rotation)
		if err != nil || rotated {
			t.Fatalf("replay stale identity rotation = %v, %v; want conflict", rotated, err)
		}
		assertSyntheticIdentityState(t, ctx, pool, userID, replacementPublicKey, replacementPrivateKey, vaultID, newVaultKey, 3)
	})

	t.Run("serializes concurrent identical identity rotations", func(t *testing.T) {
		userID := createSyntheticProfileUser(t, pool)
		currentPublicKey := syntheticEncryptionPublicKey()
		replacementPublicKey := currentPublicKey
		replacementPublicKey.X = repeatedCoordinate('C')
		currentPrivateKey := syntheticEnvelope(1, 64)
		replacementPrivateKey := syntheticEnvelope(1, 65)
		insertSyntheticIdentityProfile(t, pool, userID, currentPublicKey, currentPrivateKey)
		vaultID := insertSyntheticRotationMembership(t, pool, userID, "SHARED", "ACTIVE", "ACTIVE", 3, syntheticEnvelope(1, 64))
		oldVaultKey := syntheticEnvelope(1, 64)
		newVaultKey := syntheticEnvelope(1, 65)
		if _, err := pool.Exec(ctx, `UPDATE vault_members SET encrypted_vault_key = $3 WHERE vault_id = $1 AND user_id = $2`, vaultID, userID, oldVaultKey); err != nil {
			t.Fatalf("set concurrent rotation source membership key: %v", err)
		}
		rotation := syntheticIdentityRotation(currentPublicKey, replacementPublicKey, currentPrivateKey, replacementPrivateKey, []apiService.UserEncryptionIdentityRotationMembership{{
			VaultID: vaultID, ExpectedKeyVersion: 3, ExpectedVaultKey: oldVaultKey, ReplacementVaultKey: newVaultKey,
		}})
		results := make(chan bool, 2)
		errors := make(chan error, 2)
		var workers sync.WaitGroup
		workers.Add(2)
		for range 2 {
			go func() {
				defer workers.Done()
				rotated, err := repository.Rotate(ctx, userID, rotation)
				results <- rotated
				errors <- err
			}()
		}
		workers.Wait()
		close(results)
		close(errors)
		committed := 0
		for rotated := range results {
			if rotated {
				committed++
			}
		}
		for err := range errors {
			if err != nil {
				t.Fatalf("concurrent identity rotation: %v", err)
			}
		}
		if committed != 1 {
			t.Fatalf("concurrent identity rotation successes = %d; want one committed and one conflict", committed)
		}
		assertSyntheticIdentityState(t, ctx, pool, userID, replacementPublicKey, replacementPrivateKey, vaultID, newVaultKey, 3)
		var auditCount int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM vault_audit_events WHERE vault_id = $1`, vaultID).Scan(&auditCount); err != nil || auditCount != 1 {
			t.Fatalf("concurrent rotation audit count=%d err=%v; want one event", auditCount, err)
		}
	})
}

func insertSyntheticIdentityProfile(t *testing.T, pool *pgxpool.Pool, userID string, publicKey apiService.UserEncryptionPublicKey, privateKey []byte) {
	t.Helper()
	profile := syntheticProfile()
	publicKeyJSON, err := json.Marshal(publicKey)
	if err != nil {
		t.Fatalf("marshal synthetic identity public key: %v", err)
	}
	profile.UserEncryptionPublicKey = publicKeyJSON
	insertSyntheticCryptoProfile(t, pool, userID, profile)
	if _, err := pool.Exec(context.Background(), `
		UPDATE user_crypto_profiles
		SET encrypted_user_private_key = $2, user_encryption_key_version = 1
		WHERE user_id = $1`, userID, privateKey); err != nil {
		t.Fatalf("insert synthetic encrypted identity private key: %v", err)
	}
}

func insertSyntheticRotationMembership(t *testing.T, pool *pgxpool.Pool, userID string, vaultType string, lifecycle string, status string, keyVersion int, encryptedVaultKey []byte) string {
	t.Helper()
	vaultID, err := postgres.NewCUID()
	if err != nil {
		t.Fatalf("generate synthetic Shared Vault ID: %v", err)
	}
	now := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO vaults (id, type, lifecycle, owner_id, encryption_version, created_at, updated_at)
		VALUES ($1, $2, $3, $4, 1, $5, $5)`, vaultID, vaultType, lifecycle, userID, now); err != nil {
		t.Fatalf("insert synthetic Shared Vault: %v", err)
	}
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO vault_members (vault_id, user_id, role, status, encrypted_vault_key, key_version, created_at, updated_at)
		VALUES ($1, $2, 'OWNER', $3, $4, $5, $6, $6)`, vaultID, userID, status, encryptedVaultKey, keyVersion, now); err != nil {
		t.Fatalf("insert synthetic Shared Vault member: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM vault_audit_events WHERE vault_id = $1`, vaultID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM vault_members WHERE vault_id = $1`, vaultID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM vaults WHERE id = $1`, vaultID)
	})
	return vaultID
}

func syntheticIdentityRotation(currentKey apiService.UserEncryptionPublicKey, replacementKey apiService.UserEncryptionPublicKey, currentPrivateKey []byte, replacementPrivateKey []byte, memberships []apiService.UserEncryptionIdentityRotationMembership) apiService.UserEncryptionIdentityRotation {
	return apiService.UserEncryptionIdentityRotation{
		ExpectedPublicKey: currentKey, ExpectedEncryptedPrivateKey: currentPrivateKey, ExpectedEncryptionVersion: 1,
		PublicKey: replacementKey, EncryptedPrivateKey: replacementPrivateKey, EncryptionVersion: 1,
		Memberships: memberships,
	}
}

func assertSyntheticIdentityState(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string, publicKey apiService.UserEncryptionPublicKey, privateKey []byte, vaultID string, encryptedVaultKey []byte, memberKeyVersion int) {
	t.Helper()
	var rawPublicKey []byte
	var storedPrivateKey []byte
	var encryptionVersion int
	if err := pool.QueryRow(ctx, `SELECT user_encryption_public_key, encrypted_user_private_key, user_encryption_key_version FROM user_crypto_profiles WHERE user_id = $1`, userID).Scan(&rawPublicKey, &storedPrivateKey, &encryptionVersion); err != nil {
		t.Fatalf("read updated synthetic identity profile: %v", err)
	}
	parsedPublicKey, err := apiService.ParseUserEncryptionPublicKey(rawPublicKey)
	if err != nil || parsedPublicKey != publicKey || string(storedPrivateKey) != string(privateKey) || encryptionVersion != 1 {
		t.Fatalf("stored identity profile did not match expected values (version=%d err=%v)", encryptionVersion, err)
	}
	var storedVaultKey []byte
	var storedKeyVersion int
	if err := pool.QueryRow(ctx, `SELECT encrypted_vault_key, key_version FROM vault_members WHERE vault_id = $1 AND user_id = $2`, vaultID, userID).Scan(&storedVaultKey, &storedKeyVersion); err != nil {
		t.Fatalf("read updated synthetic membership key: %v", err)
	}
	if string(storedVaultKey) != string(encryptedVaultKey) || storedKeyVersion != memberKeyVersion {
		t.Fatalf("stored membership key did not match expected values (version=%d)", storedKeyVersion)
	}
}
