package repository

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

func TestSecureShareLinkBindsEmailAndRedeemsOnceAfterEnrollment(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.July, 29, 12, 0, 0, 0, time.UTC)
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	vaultID := insertAccessVault(t, ctx, pool, ownerID, "ACTIVE", []byte("synthetic-encrypted-name"), now, false)
	insertAccessMembership(t, ctx, pool, vaultID, ownerID, "OWNER", "ACTIVE", []byte("synthetic-owner-key-wrap"), 1, nil, nil, nil, now)
	t.Cleanup(func() { cleanupSecureShareVault(t, ctx, pool, vaultID) })
	repository, err := NewSecureShareLinkRepository(pool, func() time.Time { return now })
	if err != nil {
		t.Fatalf("create Secure Share Link repository: %v", err)
	}
	recipientEmail := "invited-before-signup@example.test"
	verifier := bytesOfValue("synthetic-link-verifier", 32)
	encryptedPackage := []byte("synthetic-encrypted-key-handoff-package")
	created, err := repository.CreateForEmail(ctx, ownerID, vaultID, strings.ToUpper(recipientEmail), apiService.NewSecureShareLink{
		LinkVerifier: verifier, EncryptedPackage: encryptedPackage, ExpectedKeyVersion: 1,
	})
	if err != nil {
		t.Fatalf("create pre-signup email invitation: %v", err)
	}
	if created.ID == "" || !created.ExpiresAt.Equal(now.Add(7*24*time.Hour)) {
		t.Fatalf("created invitation=%#v; want opaque ID and exact seven-day expiry", created)
	}
	var storedEmail string
	var storedRecipientID *string
	var storedVerifier, storedPackage []byte
	var storedExpiry time.Time
	if err := pool.QueryRow(ctx, `
		SELECT recipient_email, recipient_user_id, link_verifier, encrypted_package, expires_at
		FROM vault_invitations WHERE id = $1`, created.ID).Scan(&storedEmail, &storedRecipientID, &storedVerifier, &storedPackage, &storedExpiry); err != nil {
		t.Fatalf("read synthetic email-bound invitation: %v", err)
	}
	if storedEmail != recipientEmail || storedRecipientID != nil || string(storedVerifier) != string(verifier) ||
		string(storedPackage) != string(encryptedPackage) || !storedExpiry.Equal(created.ExpiresAt) {
		t.Fatal("stored Secure Share Link invitation differs from the email-bound encrypted contract")
	}

	recipientID := testsupport.CreateSyntheticApplicationUser(t, pool)
	recipientKey := syntheticSharePublicKey(t, "A")
	insertSecureShareCryptoProfile(t, ctx, pool, recipientID, recipientKey, now)
	recipient := apiService.SecureShareLinkRecipient{UserID: recipientID, Email: strings.ToUpper(recipientEmail)}
	if link, err := repository.FindForRecipient(ctx, recipient, verifier); err != nil || link == nil || link.ID != created.ID ||
		link.VaultID != vaultID || link.KeyVersion != 1 || string(link.EncryptedPackage) != string(encryptedPackage) {
		t.Fatalf("find enrolled recipient's link=%#v err=%v", link, err)
	}
	wrongRecipientID := testsupport.CreateSyntheticApplicationUser(t, pool)
	wrongRecipientEmail := "different-recipient@example.test"
	if _, err := pool.Exec(ctx, `UPDATE application_users SET email = $2 WHERE id = $1`, wrongRecipientID, wrongRecipientEmail); err != nil {
		t.Fatalf("set synthetic wrong-recipient email: %v", err)
	}
	wrongRecipientKey := syntheticSharePublicKey(t, "E")
	insertSecureShareCryptoProfile(t, ctx, pool, wrongRecipientID, wrongRecipientKey, now)
	wrongIdentity := apiService.SecureShareLinkRecipient{UserID: wrongRecipientID, Email: wrongRecipientEmail}
	if link, err := repository.FindForRecipient(ctx, wrongIdentity, verifier); err != nil || link != nil {
		t.Fatalf("wrong-email lookup returned link=%#v err=%v", link, err)
	}
	if err := repository.Redeem(ctx, wrongIdentity, created.ID, []byte("synthetic-wrong-recipient-wrap"), 1, wrongRecipientKey); !errors.Is(err, apiService.ErrSecureShareLinkUnavailable) {
		t.Fatalf("wrong-email redemption error=%v; want unavailable", err)
	}
	staleKey := syntheticSharePublicKey(t, "C")
	if err := repository.Redeem(ctx, recipient, created.ID, []byte("synthetic-stale-recipient-wrap"), 1, staleKey); !errors.Is(err, apiService.ErrStaleRecipientEncryptionIdentity) {
		t.Fatalf("stale User Encryption identity error=%v; want conflict", err)
	}
	wrappedVaultKey := []byte("synthetic-recipient-vault-key-wrap")
	if err := repository.Redeem(ctx, recipient, created.ID, wrappedVaultKey, 1, recipientKey); err != nil {
		t.Fatalf("redeem Secure Share Link: %v", err)
	}
	var role, status string
	var storedVaultKey []byte
	var keyVersion int32
	if err := pool.QueryRow(ctx, `
		SELECT role, status, encrypted_vault_key, key_version FROM vault_members WHERE vault_id = $1 AND user_id = $2`, vaultID, recipientID).
		Scan(&role, &status, &storedVaultKey, &keyVersion); err != nil {
		t.Fatalf("read granted membership: %v", err)
	}
	if role != "VIEWER" || status != "ACTIVE" || string(storedVaultKey) != string(wrappedVaultKey) || keyVersion != 1 {
		t.Fatalf("granted membership role=%q status=%q key=%q version=%d", role, status, storedVaultKey, keyVersion)
	}
	var invitationRecipientID *string
	var invitationStatus string
	var redeemedAt *time.Time
	if err := pool.QueryRow(ctx, `
		SELECT recipient_user_id, status, redeemed_at FROM vault_invitations WHERE id = $1`, created.ID).
		Scan(&invitationRecipientID, &invitationStatus, &redeemedAt); err != nil {
		t.Fatalf("read redeemed invitation: %v", err)
	}
	if invitationRecipientID == nil || *invitationRecipientID != recipientID || invitationStatus != "REDEEMED" || redeemedAt == nil || !redeemedAt.Equal(now) {
		t.Fatalf("redeemed invitation recipient=%v status=%q redeemedAt=%v", invitationRecipientID, invitationStatus, redeemedAt)
	}
	if link, err := repository.FindForRecipient(ctx, recipient, verifier); err != nil || link != nil {
		t.Fatalf("one-time link remained available after redemption: link=%#v err=%v", link, err)
	}
	if err := repository.Redeem(ctx, recipient, created.ID, wrappedVaultKey, 1, recipientKey); !errors.Is(err, apiService.ErrSecureShareLinkUnavailable) {
		t.Fatalf("replayed redemption error=%v; want unavailable", err)
	}
}

func TestSecureShareLinkReinvitesOnlyExpiredLinkAndResetsRevokedMemberPermissions(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.July, 29, 12, 0, 0, 0, time.UTC)
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	recipientID := testsupport.CreateSyntheticApplicationUser(t, pool)
	if _, err := pool.Exec(ctx, `UPDATE application_users SET email = $2 WHERE id = $1`, recipientID, "integration-recipient@example.test"); err != nil {
		t.Fatalf("set synthetic Secure Share Link recipient email: %v", err)
	}
	vaultID := insertAccessVault(t, ctx, pool, ownerID, "ACTIVE", []byte("synthetic-encrypted-name"), now, false)
	insertAccessMembership(t, ctx, pool, vaultID, ownerID, "OWNER", "ACTIVE", []byte("synthetic-owner-key-wrap"), 1, nil, nil, nil, now)
	insertAccessMembership(t, ctx, pool, vaultID, recipientID, "VIEWER", "REVOKED", []byte("synthetic-retained-viewer-wrap"), 1,
		ptrAccessBool(true), ptrAccessBool(false), ptrAccessBool(true), now.Add(time.Second))
	recipientKey := syntheticSharePublicKey(t, "D")
	insertSecureShareCryptoProfile(t, ctx, pool, recipientID, recipientKey, now)
	t.Cleanup(func() { cleanupSecureShareVault(t, ctx, pool, vaultID) })
	expiredID := mustSecureShareID(t)
	oldVerifier := bytesOfValue("synthetic-old-link-verifier", 32)
	if _, err := pool.Exec(ctx, `
		INSERT INTO vault_invitations (id, vault_id, recipient_user_id, recipient_email, link_verifier, encrypted_package, status, expires_at, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7, $8)`, expiredID, vaultID, recipientID, "integration-recipient@example.test",
		oldVerifier, []byte("synthetic-expired-package"), now, now.Add(-7*24*time.Hour)); err != nil {
		t.Fatalf("insert expired synthetic Invitation: %v", err)
	}
	repository, err := NewSecureShareLinkRepository(pool, func() time.Time { return now })
	if err != nil {
		t.Fatalf("create Secure Share Link repository: %v", err)
	}
	recipient := apiService.SecureShareLinkRecipient{UserID: recipientID, Email: "integration-recipient@example.test"}
	if link, err := repository.FindForRecipient(ctx, recipient, oldVerifier); err != nil || link != nil {
		t.Fatalf("expired Secure Share Link lookup=%#v err=%v", link, err)
	}
	if err := repository.Redeem(ctx, recipient, expiredID, []byte("synthetic-expired-wrap"), 1, recipientKey); !errors.Is(err, apiService.ErrSecureShareLinkUnavailable) {
		t.Fatalf("expired Secure Share Link redemption error=%v", err)
	}
	newVerifier := bytesOfValue("synthetic-replacement-link-verifier", 32)
	replacement, err := repository.CreateForEmail(ctx, ownerID, vaultID, strings.ToUpper(recipient.Email), apiService.NewSecureShareLink{
		LinkVerifier: newVerifier, EncryptedPackage: []byte("synthetic-replacement-package"), ExpectedKeyVersion: 1,
	})
	if err != nil || !replacement.ExpiresAt.Equal(now.Add(7*24*time.Hour)) {
		t.Fatalf("replace expired Invitation=%#v err=%v", replacement, err)
	}
	var oldCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM vault_invitations WHERE id = $1`, expiredID).Scan(&oldCount); err != nil || oldCount != 0 {
		t.Fatalf("expired Invitation persisted count=%d err=%v", oldCount, err)
	}
	if link, err := repository.FindForRecipient(ctx, recipient, oldVerifier); err != nil || link != nil {
		t.Fatalf("old verifier still resolved after re-invitation: link=%#v err=%v", link, err)
	}
	_, conflictErr := repository.CreateForEmail(ctx, ownerID, vaultID, recipient.Email, apiService.NewSecureShareLink{
		LinkVerifier: bytesOfValue("synthetic-conflicting-link-verifier", 32), EncryptedPackage: []byte("synthetic-conflicting-package"), ExpectedKeyVersion: 1,
	})
	if !errors.Is(conflictErr, apiService.ErrInvitationConflict) {
		t.Fatalf("second unexpired invitation error=%v; want conflict", conflictErr)
	}
	if err := repository.Redeem(ctx, recipient, replacement.ID, []byte("synthetic-replacement-vault-wrap"), 1, recipientKey); err != nil {
		t.Fatalf("redeem replacement link for revoked Viewer: %v", err)
	}
	var status string
	var addOverride, editOverride, deleteOverride *bool
	var permissionsRevision int32
	if err := pool.QueryRow(ctx, `
		SELECT status, can_add_accounts_override, can_edit_accounts_override, can_delete_accounts_override, permissions_revision
		FROM vault_members WHERE vault_id = $1 AND user_id = $2`, vaultID, recipientID).
		Scan(&status, &addOverride, &editOverride, &deleteOverride, &permissionsRevision); err != nil {
		t.Fatalf("read reactivated Viewer permissions: %v", err)
	}
	if status != "ACTIVE" || addOverride != nil || editOverride != nil || deleteOverride != nil || permissionsRevision != 2 {
		t.Fatalf("reactivated Viewer status=%q overrides=(%v,%v,%v) revision=%d", status, addOverride, editOverride, deleteOverride, permissionsRevision)
	}
}

func TestSecureShareLinkDoesNotFollowARecycledEmailBinding(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.August, 10, 11, 12, 13, 0, time.UTC)
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	recipientEmail := "recycled-share-recipient@example.test"
	recipientID := testsupport.CreateSyntheticApplicationUser(t, pool)
	if _, err := pool.Exec(ctx, `UPDATE application_users SET email = $2 WHERE id = $1`, recipientID, recipientEmail); err != nil {
		t.Fatalf("set synthetic recipient email: %v", err)
	}
	vaultID := insertAccessVault(t, ctx, pool, ownerID, "ACTIVE", []byte("synthetic-encrypted-name"), now, false)
	insertAccessMembership(t, ctx, pool, vaultID, ownerID, "OWNER", "ACTIVE", []byte("synthetic-owner-key-wrap"), 1, nil, nil, nil, now)
	t.Cleanup(func() { cleanupSecureShareVault(t, ctx, pool, vaultID) })
	repository, err := NewSecureShareLinkRepository(pool, func() time.Time { return now })
	if err != nil {
		t.Fatalf("create Secure Share Link repository: %v", err)
	}
	verifier := bytesOfValue("synthetic-bound-recipient-verifier", 32)
	created, err := repository.CreateForEmail(ctx, ownerID, vaultID, recipientEmail, apiService.NewSecureShareLink{
		LinkVerifier: verifier, EncryptedPackage: []byte("synthetic-encrypted-package"), ExpectedKeyVersion: 1,
	})
	if err != nil {
		t.Fatalf("create ID-bound invitation: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE application_users SET email = $2 WHERE id = $1`, recipientID, "changed-recipient@example.test"); err != nil {
		t.Fatalf("change original recipient email: %v", err)
	}
	otherID := testsupport.CreateSyntheticApplicationUser(t, pool)
	if _, err := pool.Exec(ctx, `UPDATE application_users SET email = $2 WHERE id = $1`, otherID, recipientEmail); err != nil {
		t.Fatalf("assign recycled email to a different synthetic user: %v", err)
	}
	otherKey := syntheticSharePublicKey(t, "F")
	insertSecureShareCryptoProfile(t, ctx, pool, otherID, otherKey, now)
	if link, err := repository.FindForRecipient(ctx, apiService.SecureShareLinkRecipient{UserID: otherID, Email: recipientEmail}, verifier); err != nil || link != nil {
		t.Fatalf("recycled email resolved a bound link=%#v err=%v", link, err)
	}
	if err := repository.Redeem(ctx, apiService.SecureShareLinkRecipient{UserID: otherID, Email: recipientEmail}, created.ID,
		[]byte("synthetic-recycled-email-wrap"), 1, otherKey); !errors.Is(err, apiService.ErrSecureShareLinkUnavailable) {
		t.Fatalf("recycled email redemption error=%v; want stale identity or unavailable", err)
	}
}

func insertSecureShareCryptoProfile(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string, publicKey apiService.UserEncryptionPublicKey, now time.Time) {
	t.Helper()
	serialized, err := json.Marshal(publicKey)
	if err != nil {
		t.Fatalf("encode synthetic User Encryption public key: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO user_crypto_profiles (
			user_id, vault_unlock_salt, wrapped_user_root_key, root_key_wrapping_version,
			encrypted_personal_vault_key, personal_vault_key_encryption_version, user_encryption_public_key,
			encrypted_user_private_key, user_encryption_key_version, created_at, updated_at
		)
		VALUES ($1, $2, $3, 1, $4, 1, $5::jsonb, $6, 1, $7, $7)`,
		userID, []byte("synthetic-salt"), []byte("synthetic-root-wrap"), []byte("synthetic-personal-vault-key"), string(serialized),
		[]byte("synthetic-encrypted-private-key"), now); err != nil {
		t.Fatalf("insert synthetic User Crypto Profile: %v", err)
	}
}

func syntheticSharePublicKey(t *testing.T, xCharacter string) apiService.UserEncryptionPublicKey {
	t.Helper()
	key, err := apiService.ParseUserEncryptionPublicKey([]byte(`{"kty":"EC","crv":"P-256","x":"` + strings.Repeat(xCharacter, 43) + `","y":"` + strings.Repeat("B", 43) + `"}`))
	if err != nil {
		t.Fatalf("parse synthetic User Encryption public key: %v", err)
	}
	return key
}

func cleanupSecureShareVault(t *testing.T, ctx context.Context, pool *pgxpool.Pool, vaultID string) {
	t.Helper()
	for _, statement := range []string{
		`DELETE FROM vault_invitations WHERE vault_id = $1`,
		`DELETE FROM vault_audit_events WHERE vault_id = $1`,
		`DELETE FROM authenticator_accounts WHERE vault_id = $1`,
		`DELETE FROM vault_members WHERE vault_id = $1`,
		`DELETE FROM vaults WHERE id = $1`,
	} {
		if _, err := pool.Exec(ctx, statement, vaultID); err != nil {
			t.Errorf("clean synthetic Secure Share Vault: %v", err)
		}
	}
}

func bytesOfValue(value string, length int) []byte {
	bytes := make([]byte, length)
	copy(bytes, value)
	if len(value) < length {
		for index := len(value); index < length; index++ {
			bytes[index] = byte(index % 251)
		}
	}
	return bytes
}

func mustSecureShareID(t *testing.T) string {
	t.Helper()
	id, err := testsupport.NewSyntheticCUID()
	if err != nil {
		t.Fatalf("generate synthetic invitation ID: %v", err)
	}
	return id
}
