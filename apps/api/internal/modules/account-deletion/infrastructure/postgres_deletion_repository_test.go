package infrastructure

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	accountapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/account-deletion/application"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/postgres"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

func TestPostgresDeletionRepositoryDeletesUserDataAndTransfersOnlySelectedSharedVault(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	viewerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	otherMemberID := testsupport.CreateSyntheticApplicationUser(t, pool)
	const sessionSecret = "synthetic-session-secret-with-at-least-32-bytes"
	const anonymousSecret = "synthetic-magic-link-secret-with-at-least-32-bytes"
	deletionRepository, err := NewPostgresDeletionRepository(pool, []byte(sessionSecret), []byte(anonymousSecret))
	if err != nil {
		t.Fatalf("create account deletion repository: %v", err)
	}
	defer deletionRepository.Close()
	otpRepository, err := NewPostgresPasswordlessOTPRepository(pool, []byte(sessionSecret))
	if err != nil {
		t.Fatalf("create passwordless OTP repository: %v", err)
	}
	defer otpRepository.Close()
	now := time.Now().UTC().Truncate(time.Millisecond)
	personalVaultID := mustSyntheticID(t)
	sharedTransferID := mustSyntheticID(t)
	sharedDeleteID := mustSyntheticID(t)
	otherSharedID := mustSyntheticID(t)
	insertDeletionVault(t, ctx, pool, personalVaultID, ownerID, "PERSONAL", "ACTIVE", now)
	insertDeletionVault(t, ctx, pool, sharedTransferID, ownerID, "SHARED", "ACTIVE", now)
	insertDeletionVault(t, ctx, pool, sharedDeleteID, ownerID, "SHARED", "ACTIVE", now)
	insertDeletionVault(t, ctx, pool, otherSharedID, otherMemberID, "SHARED", "ACTIVE", now)
	insertDeletionMember(t, ctx, pool, personalVaultID, ownerID, "OWNER", nil, 0, now)
	insertDeletionMember(t, ctx, pool, sharedTransferID, ownerID, "OWNER", nil, 0, now)
	insertDeletionMember(t, ctx, pool, sharedTransferID, viewerID, "VIEWER", []byte("synthetic-current-encrypted-key"), 1, now)
	insertDeletionMember(t, ctx, pool, sharedDeleteID, ownerID, "OWNER", nil, 0, now)
	insertDeletionMember(t, ctx, pool, otherSharedID, ownerID, "VIEWER", []byte("synthetic-current-encrypted-key"), 1, now)
	insertDeletionAccount(t, ctx, pool, personalVaultID, now)
	insertDeletionAccount(t, ctx, pool, sharedDeleteID, now)
	insertDeletionAccount(t, ctx, pool, sharedTransferID, now)

	transferInvitationID := insertDeletionInvitation(t, ctx, pool, sharedTransferID, viewerID, "viewer@example.test", now)
	ownerInvitationID := insertDeletionInvitation(t, ctx, pool, sharedTransferID, ownerID, "ignored@example.test", now)
	deletedVaultInvitationID := insertDeletionInvitation(t, ctx, pool, sharedDeleteID, viewerID, "viewer@example.test", now)
	otherInvitationID := insertDeletionInvitation(t, ctx, pool, otherSharedID, otherMemberID, "other-member@example.test", now)
	transferOwnerAuditID := insertDeletionAudit(t, ctx, pool, sharedTransferID, ownerID, now)
	transferViewerAuditID := insertDeletionAudit(t, ctx, pool, sharedTransferID, viewerID, now)
	deletedAuditID := insertDeletionAudit(t, ctx, pool, sharedDeleteID, ownerID, now)
	seedDeletionIdentityData(t, ctx, pool, ownerID, deletionRepository, now)

	challenge, err := otpRepository.CreatePasswordlessOTPChallenge(ctx, ownerID, now)
	if err != nil {
		t.Fatalf("create deletion authorization challenge: %v", err)
	}
	authorizationToken, err := otpRepository.VerifyPasswordlessOTP(ctx, ownerID, challenge.OTP, now.Add(time.Second))
	if err != nil {
		t.Fatalf("verify deletion authorization OTP: %v", err)
	}
	transferTarget := viewerID
	request := accountapp.DeletionRequest{
		Confirmation: accountapp.DeletionConfirmation,
		Acknowledged: true,
		VaultDecisions: []accountapp.VaultDecision{
			{VaultID: sharedTransferID, Action: accountapp.VaultActionTransfer, TransferToUserID: accountapp.OptionalString{Value: transferTarget, Present: true}},
			{VaultID: sharedDeleteID, Action: accountapp.VaultActionDelete},
		},
	}
	result, err := deletionRepository.DeleteUser(ctx, ownerID, authorizationToken, request, now.Add(2*time.Second))
	if err != nil {
		t.Fatalf("delete synthetic application user: %v", err)
	}
	if result.ReceiptID == "" || result.Email != syntheticUserEmail(ownerID) || result.EmailDelivery != "pending" ||
		result.PersonalVaultCount != 1 || result.SharedVaultDeletedCount != 1 || result.SharedVaultTransferredCount != 1 || result.AuthenticatorAccountCount != 2 {
		t.Fatalf("account deletion result counters do not match fixture: %#v", result)
	}
	assertDeletionRowCount(t, ctx, pool, `SELECT COUNT(*) FROM application_users WHERE id = $1`, ownerID, 0)
	assertDeletionRowCount(t, ctx, pool, `SELECT COUNT(*) FROM vaults WHERE id = ANY($1::text[])`, []string{personalVaultID, sharedDeleteID}, 0)
	assertDeletionRowCount(t, ctx, pool, `SELECT COUNT(*) FROM vaults WHERE id = $1 AND owner_id = $2`, sharedTransferID, viewerID, 1)
	assertDeletionRowCount(t, ctx, pool, `SELECT COUNT(*) FROM vault_members WHERE user_id = $1 OR vault_id = ANY($2::text[])`, ownerID, []string{personalVaultID, sharedDeleteID}, 0)
	var promotedRole string
	var promotedRevision int
	if err := pool.QueryRow(ctx, `SELECT role, permissions_revision FROM vault_members WHERE vault_id = $1 AND user_id = $2`, sharedTransferID, viewerID).Scan(&promotedRole, &promotedRevision); err != nil {
		t.Fatalf("read transferred Shared Vault membership: %v", err)
	}
	if promotedRole != "OWNER" || promotedRevision != 2 {
		t.Fatalf("transfer target role/revision=%s/%d; want OWNER/2", promotedRole, promotedRevision)
	}
	assertDeletionRowCount(t, ctx, pool, `SELECT COUNT(*) FROM vault_invitations WHERE id = $1`, transferInvitationID, 1)
	assertDeletionRowCount(t, ctx, pool, `SELECT COUNT(*) FROM vault_invitations WHERE id = ANY($1::text[])`, []string{ownerInvitationID, deletedVaultInvitationID}, 0)
	assertDeletionRowCount(t, ctx, pool, `SELECT COUNT(*) FROM vault_invitations WHERE id = $1`, otherInvitationID, 1)
	assertDeletionRowCount(t, ctx, pool, `SELECT COUNT(*) FROM vault_audit_events WHERE id = $1`, transferOwnerAuditID, 0)
	assertDeletionRowCount(t, ctx, pool, `SELECT COUNT(*) FROM vault_audit_events WHERE id = $1`, deletedAuditID, 0)
	assertDeletionRowCount(t, ctx, pool, `SELECT COUNT(*) FROM vault_audit_events WHERE id = $1`, transferViewerAuditID, 1)
	assertDeletionRowCount(t, ctx, pool, `SELECT COUNT(*) FROM external_identities WHERE application_user_id = $1`, ownerID, 0)
	assertDeletionRowCount(t, ctx, pool, `SELECT COUNT(*) FROM account_deletion_identities WHERE deletion_record_id = $1`, result.ReceiptID, 1)
	assertDeletionRowCount(t, ctx, pool, `SELECT COUNT(*) FROM auth_sessions WHERE application_user_id = $1`, ownerID, 0)
	assertDeletionRowCount(t, ctx, pool, `SELECT COUNT(*) FROM magic_link_challenges WHERE normalized_email = $1`, strings.ToLower(syntheticUserEmail(ownerID)), 0)
	assertDeletionRowCount(t, ctx, pool, `SELECT COUNT(*) FROM pwa_authentication_handoffs WHERE normalized_email = $1`, strings.ToLower(syntheticUserEmail(ownerID)), 0)
	assertDeletionRowCount(t, ctx, pool, `SELECT COUNT(*) FROM application_rate_limit_windows WHERE user_id = $1`, ownerID, 0)
	assertDeletionRowCount(t, ctx, pool, `SELECT COUNT(*) FROM identity_security_events WHERE application_user_id = $1`, ownerID, 0)
	assertDeletionRowCount(t, ctx, pool, `SELECT COUNT(*) FROM user_crypto_profiles WHERE user_id = $1`, ownerID, 0)
	assertDeletionRowCount(t, ctx, pool, `SELECT COUNT(*) FROM passkey_recovery_credentials WHERE user_id = $1`, ownerID, 0)
	assertDeletionRowCount(t, ctx, pool, `SELECT COUNT(*) FROM passkey_recovery_challenges WHERE user_id = $1`, ownerID, 0)
	assertDeletionRowCount(t, ctx, pool, `SELECT COUNT(*) FROM account_deletion_metrics WHERE auth_backend = 'passwordless' AND occurred_at >= $1`, now.Add(-time.Second), 1)

	completed, err := deletionRepository.FindCompletedDeletion(ctx, authorizationToken)
	if err != nil || completed == nil || completed.ReceiptID != result.ReceiptID || completed.EmailDelivery != "failed" {
		t.Fatalf("completed deletion receipt=%#v err=%v; pending email maps to failed receipt", completed, err)
	}
	if err := deletionRepository.RecordCompletionEmailStatus(ctx, result.ReceiptID, "SENT"); err != nil {
		t.Fatalf("record synthetic receipt email delivery: %v", err)
	}
	completed, err = deletionRepository.FindCompletedDeletion(ctx, authorizationToken)
	if err != nil || completed == nil || completed.EmailDelivery != "sent" {
		t.Fatalf("updated deletion receipt=%#v err=%v", completed, err)
	}
	replayed, err := deletionRepository.DeleteUser(ctx, ownerID, authorizationToken, request, now.Add(3*time.Second))
	if err != nil || replayed.ReceiptID != result.ReceiptID {
		t.Fatalf("idempotent repository replay=%#v err=%v; want original receipt", replayed, err)
	}
}

func TestPostgresDeletionRepositoryRejectsStaleVaultPlanWithoutDeletingUser(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	viewerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	deletionRepository, err := NewPostgresDeletionRepository(pool, []byte("synthetic-session-secret-with-at-least-32-bytes"), []byte("synthetic-magic-link-secret-with-at-least-32-bytes"))
	if err != nil {
		t.Fatalf("create account deletion repository: %v", err)
	}
	defer deletionRepository.Close()
	otpRepository, err := NewPostgresPasswordlessOTPRepository(pool, []byte("synthetic-session-secret-with-at-least-32-bytes"))
	if err != nil {
		t.Fatalf("create passwordless OTP repository: %v", err)
	}
	defer otpRepository.Close()
	now := time.Now().UTC().Truncate(time.Millisecond)
	sharedID := mustSyntheticID(t)
	insertDeletionVault(t, ctx, pool, sharedID, ownerID, "SHARED", "ACTIVE", now)
	insertDeletionMember(t, ctx, pool, sharedID, ownerID, "OWNER", nil, 0, now)
	insertDeletionMember(t, ctx, pool, sharedID, viewerID, "VIEWER", []byte{}, 1, now)
	challenge, err := otpRepository.CreatePasswordlessOTPChallenge(ctx, ownerID, now)
	if err != nil {
		t.Fatalf("create deletion challenge: %v", err)
	}
	token, err := otpRepository.VerifyPasswordlessOTP(ctx, ownerID, challenge.OTP, now.Add(time.Second))
	if err != nil {
		t.Fatalf("verify deletion challenge: %v", err)
	}
	request := accountapp.DeletionRequest{
		Confirmation: accountapp.DeletionConfirmation,
		Acknowledged: true,
		VaultDecisions: []accountapp.VaultDecision{{
			VaultID:          sharedID,
			Action:           accountapp.VaultActionTransfer,
			TransferToUserID: accountapp.OptionalString{Value: viewerID, Present: true},
		}},
	}
	if _, err := deletionRepository.DeleteUser(ctx, ownerID, token, request, now.Add(2*time.Second)); !errors.Is(err, accountapp.ErrDeletionPlanStale) {
		t.Fatalf("stale plan error=%v; want conflict error", err)
	}
	assertDeletionRowCount(t, ctx, pool, `SELECT COUNT(*) FROM application_users WHERE id = $1`, ownerID, 1)
	assertDeletionRowCount(t, ctx, pool, `SELECT COUNT(*) FROM vaults WHERE id = $1`, sharedID, 1)
}

func seedDeletionIdentityData(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string, repository *PostgresDeletionRepository, now time.Time) {
	t.Helper()
	email := syntheticUserEmail(userID)
	identityID := mustSyntheticID(t)
	if _, err := pool.Exec(ctx, `
		INSERT INTO external_identities (id, application_user_id, issuer, subject, email, updated_at)
		VALUES ($1, $2, 'https://issuer.example.test', $3, $4, $5)`, identityID, userID, "synthetic-subject-"+userID, email, now); err != nil {
		t.Fatalf("insert synthetic external identity: %v", err)
	}
	identityPasswordlessID := mustSyntheticID(t)
	if _, err := pool.Exec(ctx, `
		INSERT INTO passwordless_identities (id, external_identity_id, normalized_email, updated_at)
		VALUES ($1, $2, $3, $4)`, identityPasswordlessID, identityID, strings.ToLower(email), now); err != nil {
		t.Fatalf("insert synthetic passwordless identity: %v", err)
	}
	sessionID := mustSyntheticID(t)
	if _, err := pool.Exec(ctx, `
		INSERT INTO auth_sessions
			(id, application_user_id, access_token_digest, refresh_token_digest, refresh_family, access_expires_at, refresh_expires_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, sessionID, userID, []byte("synthetic-access-digest"), []byte("synthetic-refresh-digest"), "synthetic-family-"+sessionID, now.Add(time.Hour), now.Add(24*time.Hour), now); err != nil {
		t.Fatalf("insert synthetic auth session: %v", err)
	}
	handoffID := mustSyntheticID(t)
	if _, err := pool.Exec(ctx, `
		INSERT INTO pwa_authentication_handoffs
			(id, handoff_id_digest, verifier_digest, session_id, return_path, expires_at, normalized_email)
		VALUES ($1, $2, $3, $4, '/vaults', $5, $6)`, handoffID, []byte("synthetic-handoff-digest"), []byte("synthetic-verifier-digest"), sessionID, now.Add(time.Hour), strings.ToLower(email)); err != nil {
		t.Fatalf("insert synthetic PWA handoff: %v", err)
	}
	magicChallengeID := mustSyntheticID(t)
	if _, err := pool.Exec(ctx, `
		INSERT INTO magic_link_challenges
			(id, normalized_email, token_digest, client, return_path, expires_at)
		VALUES ($1, $2, $3, 'web', '/vaults', $4)`, magicChallengeID, strings.ToLower(email), []byte("synthetic-magic-digest"), now.Add(time.Hour)); err != nil {
		t.Fatalf("insert synthetic magic link challenge: %v", err)
	}
	profileData := []byte("synthetic-encrypted-profile-data")
	if _, err := pool.Exec(ctx, `
		INSERT INTO user_crypto_profiles
			(user_id, vault_unlock_salt, wrapped_user_root_key, root_key_wrapping_version,
			 encrypted_personal_vault_key, personal_vault_key_encryption_version, updated_at)
		VALUES ($1, $2, $3, 1, $4, 1, $5)`, userID, []byte("synthetic-salt"), profileData, profileData, now); err != nil {
		t.Fatalf("insert synthetic user crypto profile: %v", err)
	}
	passkeyChallengeID := mustSyntheticID(t)
	if _, err := pool.Exec(ctx, `
		INSERT INTO passkey_recovery_challenges (id, user_id, purpose, challenge, expires_at)
		VALUES ($1, $2, 'AUTHENTICATION', 'synthetic-challenge', $3)`, passkeyChallengeID, userID, now.Add(time.Minute)); err != nil {
		t.Fatalf("insert synthetic passkey recovery challenge: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO passkey_recovery_credentials
			(user_id, credential_id, public_key, counter, encrypted_recovery_package, updated_at)
		VALUES ($1, $2, $3, 0, $4, $5)`, userID, []byte("synthetic-credential-id"), []byte("synthetic-public-key"), []byte("synthetic-encrypted-recovery-package"), now); err != nil {
		t.Fatalf("insert synthetic passkey recovery credential: %v", err)
	}
	securityEventID := mustSyntheticID(t)
	if _, err := pool.Exec(ctx, `INSERT INTO identity_security_events (id, application_user_id, event_type) VALUES ($1, $2, 'synthetic-event')`, securityEventID, userID); err != nil {
		t.Fatalf("insert synthetic security event: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO application_rate_limit_windows (user_id, operation, window_started_at, expires_at, request_count)
		VALUES ($1, 'destructive_mutation', $2, $3, 1)`, userID, now, now.Add(time.Hour)); err != nil {
		t.Fatalf("insert synthetic application rate limit: %v", err)
	}
	mac := hmac.New(sha256.New, repository.anonymousAuthSecret)
	_, _ = mac.Write([]byte("magic-link-email:" + strings.ToLower(email)))
	if _, err := pool.Exec(ctx, `
		INSERT INTO anonymous_auth_rate_limit_windows (bucket_hash, operation, window_started_at, expires_at, request_count)
		VALUES ($1, 'magic-link-email', $2, $3, 1)`, mac.Sum(nil), now, now.Add(time.Hour)); err != nil {
		t.Fatalf("insert synthetic anonymous auth rate limit: %v", err)
	}
}

func insertDeletionVault(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id string, ownerID string, vaultType string, lifecycle string, now time.Time) {
	t.Helper()
	if _, err := pool.Exec(ctx, `
		INSERT INTO vaults (id, type, lifecycle, owner_id, encrypted_name, encryption_version, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, 1, $6, $6)`, id, vaultType, lifecycle, ownerID, []byte("synthetic-encrypted-vault-name"), now); err != nil {
		t.Fatalf("insert synthetic deletion Vault: %v", err)
	}
}

func insertDeletionMember(t *testing.T, ctx context.Context, pool *pgxpool.Pool, vaultID string, userID string, role string, encryptedKey []byte, keyVersion int, now time.Time) {
	t.Helper()
	var keyVersionValue any
	if encryptedKey != nil {
		keyVersionValue = keyVersion
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO vault_members (vault_id, user_id, role, encrypted_vault_key, key_version, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $6)`, vaultID, userID, role, encryptedKey, keyVersionValue, now); err != nil {
		t.Fatalf("insert synthetic deletion membership: %v", err)
	}
}

func insertDeletionAccount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, vaultID string, now time.Time) {
	t.Helper()
	id := mustSyntheticID(t)
	if _, err := pool.Exec(ctx, `
		INSERT INTO authenticator_accounts (id, vault_id, encrypted_payload, encryption_version, updated_at)
		VALUES ($1, $2, $3, 1, $4)`, id, vaultID, []byte("synthetic-encrypted-account-payload"), now); err != nil {
		t.Fatalf("insert synthetic encrypted authenticator account: %v", err)
	}
}

func insertDeletionInvitation(t *testing.T, ctx context.Context, pool *pgxpool.Pool, vaultID string, recipientID string, recipientEmail string, now time.Time) string {
	t.Helper()
	id := mustSyntheticID(t)
	verifier := []byte("synthetic-invitation-verifier-" + id)
	if _, err := pool.Exec(ctx, `
		INSERT INTO vault_invitations (id, vault_id, recipient_user_id, recipient_email, link_verifier, encrypted_package, created_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, id, vaultID, recipientID, recipientEmail, verifier, []byte("synthetic-encrypted-invitation-package"), now, now.Add(time.Hour)); err != nil {
		t.Fatalf("insert synthetic deletion invitation: %v", err)
	}
	return id
}

func insertDeletionAudit(t *testing.T, ctx context.Context, pool *pgxpool.Pool, vaultID string, actorID string, now time.Time) string {
	t.Helper()
	id := mustSyntheticID(t)
	if _, err := pool.Exec(ctx, `
		INSERT INTO vault_audit_events (id, vault_id, actor_user_id, event_type, created_at)
		VALUES ($1, $2, $3, 'synthetic-event', $4)`, id, vaultID, actorID, now); err != nil {
		t.Fatalf("insert synthetic deletion audit event: %v", err)
	}
	return id
}

func assertDeletionRowCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, query string, values ...any) {
	t.Helper()
	if len(values) == 0 {
		t.Fatal("synthetic deletion row-count assertion omitted expected count")
	}
	expected, ok := values[len(values)-1].(int)
	if !ok {
		t.Fatalf("synthetic deletion expected count has type %T; want int", values[len(values)-1])
	}
	var actual int
	if err := pool.QueryRow(ctx, query, values[:len(values)-1]...).Scan(&actual); err != nil {
		t.Fatalf("query synthetic deletion row count: %v", err)
	}
	if actual != expected {
		t.Fatalf("synthetic deletion row count=%d; want %d for query %q", actual, expected, query)
	}
}

func mustSyntheticID(t *testing.T) string {
	t.Helper()
	id, err := postgres.NewCUID()
	if err != nil {
		t.Fatalf("generate synthetic CUID: %v", err)
	}
	return id
}

func syntheticUserEmail(userID string) string {
	return "integration-" + userID + "@example.test"
}
