package infrastructure

import (
	"context"
	"strings"
	"testing"
	"time"

	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

func TestPostgresSharedVaultKeyWrapMigrationIsAuthorizedReplaySafeAndVersionBound(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.May, 6, 7, 8, 9, 0, time.UTC)
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	viewerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	outsiderID := testsupport.CreateSyntheticApplicationUser(t, pool)
	vaultID := insertAccessVault(t, ctx, pool, ownerID, "ACTIVE", []byte("synthetic-vault-name"), now, true)
	insertAccessMembership(t, ctx, pool, vaultID, ownerID, "OWNER", "ACTIVE", []byte("synthetic-owner-wrap"), 1, nil, nil, nil, now)
	legacyWrap := []byte(`{"version":1,"ciphertext":"synthetic-legacy-wrap"}`)
	insertAccessMembership(t, ctx, pool, vaultID, viewerID, "VIEWER", "ACTIVE", legacyWrap, 3, nil, nil, nil, now.Add(time.Second))
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM vault_audit_events WHERE vault_id = $1`, vaultID)
		_, _ = pool.Exec(ctx, `DELETE FROM authenticator_accounts WHERE vault_id = $1`, vaultID)
		_, _ = pool.Exec(ctx, `DELETE FROM vault_members WHERE vault_id = $1`, vaultID)
		_, _ = pool.Exec(ctx, `DELETE FROM vaults WHERE id = $1`, vaultID)
	})
	repository, err := NewPostgresSharedVaultAccessRepository(pool)
	if err != nil {
		t.Fatalf("create Shared Vault access repository: %v", err)
	}
	replacement := syntheticKeyWrapV2()
	replacementDigest := sharedapp.SHA256Base64URL(replacement)
	migration := sharedapp.EncryptedPayloadMigration{
		ExpectedEnvelopeVersion:     1,
		ReplacementEnvelopeVersion:  2,
		ExpectedCiphertextDigest:    sharedapp.SHA256Base64URL(legacyWrap),
		ReplacementCiphertextDigest: replacementDigest,
		ReplacementCiphertext:       replacement,
		OperationID:                 replacementDigest,
	}
	result, err := repository.MigrateKeyWrap(ctx, viewerID, vaultID, 3, migration)
	if err != nil || result != sharedapp.EncryptedPayloadMigrationCommitted {
		t.Fatalf("migrate viewer key wrap: result=%q err=%v", result, err)
	}
	var storedWrap []byte
	var keyVersion int32
	if err := pool.QueryRow(ctx, `SELECT encrypted_vault_key, key_version FROM vault_members WHERE vault_id = $1 AND user_id = $2`, vaultID, viewerID).Scan(&storedWrap, &keyVersion); err != nil ||
		string(storedWrap) != string(replacement) || keyVersion != 3 {
		t.Fatalf("migrated viewer key wrap=%s version=%d err=%v", storedWrap, keyVersion, err)
	}
	result, err = repository.MigrateKeyWrap(ctx, viewerID, vaultID, 3, migration)
	if err != nil || result != sharedapp.EncryptedPayloadMigrationAlreadyCommitted {
		t.Fatalf("replay viewer key-wrap migration: result=%q err=%v", result, err)
	}
	result, err = repository.MigrateKeyWrap(ctx, viewerID, vaultID, 2, migration)
	if err != nil || result != sharedapp.EncryptedPayloadMigrationConflict {
		t.Fatalf("stale key-wrap migration: result=%q err=%v", result, err)
	}
	result, err = repository.MigrateKeyWrap(ctx, outsiderID, vaultID, 3, migration)
	if err != nil || result != sharedapp.EncryptedPayloadMigrationConflict {
		t.Fatalf("non-member key-wrap migration: result=%q err=%v", result, err)
	}
	if err := pool.QueryRow(ctx, `SELECT encrypted_vault_key FROM vault_members WHERE vault_id = $1 AND user_id = $2`, vaultID, viewerID).Scan(&storedWrap); err != nil || string(storedWrap) != string(replacement) {
		t.Fatalf("failed key-wrap migration changed the ciphertext: %s err=%v", storedWrap, err)
	}
}

func TestSharedVaultKeyWrapMigrationValidationRejectsMalformedVersionedEnvelopes(t *testing.T) {
	valid := syntheticKeyWrapV2()
	migration := sharedapp.EncryptedPayloadMigration{
		ExpectedEnvelopeVersion:     1,
		ReplacementEnvelopeVersion:  2,
		ExpectedCiphertextDigest:    sharedapp.SHA256Base64URL([]byte("synthetic-legacy-wrap")),
		ReplacementCiphertextDigest: sharedapp.SHA256Base64URL(valid),
		ReplacementCiphertext:       valid,
		OperationID:                 sharedapp.SHA256Base64URL(valid),
	}
	if !validKeyWrapMigration(migration) {
		t.Fatal("valid synthetic key-wrap envelope was rejected")
	}
	invalid := [][]byte{
		[]byte(strings.Replace(string(valid), `"version":2`, `"version":1`, 1)),
		[]byte(strings.Replace(string(valid), `"nonce":"`+strings.Repeat("B", 16)+`"`, `"nonce":null`, 1)),
		[]byte(strings.Replace(string(valid), `"y":"`+strings.Repeat("D", 43)+`"`, `"y":"short"`, 1)),
		[]byte(strings.Replace(string(valid), `"ephemeralPublicKey":{`, `"ephemeralPublicKey":{"key_ops":["encrypt"],`, 1)),
		[]byte(strings.TrimSuffix(string(valid), "}") + `,"unexpected":true}`),
		append([]byte{0xff}, valid[1:]...),
	}
	for index, replacement := range invalid {
		migration.ReplacementCiphertext = replacement
		migration.ReplacementCiphertextDigest = sharedapp.SHA256Base64URL(replacement)
		migration.OperationID = migration.ReplacementCiphertextDigest
		if validKeyWrapMigration(migration) {
			t.Errorf("malformed key-wrap envelope case %d was accepted", index)
		}
	}
}

func TestLegacySharedVaultKeyWrapRecognitionMatchesStoredV1Representations(t *testing.T) {
	if !isLegacyKeyWrapCiphertext([]byte{1, 2, 3}) || !isLegacyKeyWrapCiphertext([]byte(`{"version":1,"payload":"synthetic"}`)) {
		t.Fatal("recognized legacy v1 key-wrap representation was rejected")
	}
	if isLegacyKeyWrapCiphertext([]byte{2, 3, 4}) || isLegacyKeyWrapCiphertext([]byte(` {"version":1}`)) ||
		isLegacyKeyWrapCiphertext([]byte(`{"version":2}`)) || isLegacyKeyWrapCiphertext([]byte(`[]`)) {
		t.Fatal("non-legacy key-wrap representation was accepted")
	}
}

func syntheticKeyWrapV2() []byte {
	return []byte(`{"version":2,"ciphertext":"` + strings.Repeat("A", 64) + `","nonce":"` + strings.Repeat("B", 16) +
		`","ephemeralPublicKey":{"kty":"EC","crv":"P-256","x":"` + strings.Repeat("C", 43) + `","y":"` +
		strings.Repeat("D", 43) + `"}}`)
}
