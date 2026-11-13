package infrastructure

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity/application"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

func TestPostgresPasswordlessRepositoryIntegration(t *testing.T) {
	pool := newGoIntegrationPool(t)
	ctx := context.Background()
	now := time.Now().UTC()
	configuration := identityapp.PasswordlessConfiguration{
		MagicLinkSecret:        []byte(strings.Repeat("m", 32)),
		SessionSecret:          []byte(strings.Repeat("s", 32)),
		MagicLinkTTLSeconds:    900,
		AccessTokenTTLSeconds:  900,
		RefreshTokenTTLSeconds: 86_400,
	}
	repository, err := NewPostgresPasswordlessAuthRepository(pool, configuration)
	if err != nil {
		t.Fatalf("create passwordless repository: %v", err)
	}
	email := fmt.Sprintf("passwordless-%d@example.test", now.UnixNano())
	magicToken := strings.Repeat("m", 43)
	magicDigest := hmacTestDigest(configuration.MagicLinkSecret, magicToken)
	handoffID := strings.Repeat("h", 16)
	handoffVerifier := strings.Repeat("v", 43)
	handoff := &identityapp.PWAHandoffChallenge{
		IDDigest:       hmacTestDigest(configuration.MagicLinkSecret, handoffID),
		VerifierDigest: hmacTestDigest(configuration.MagicLinkSecret, handoffVerifier),
		ExpiresAt:      now.Add(15 * time.Minute),
	}
	webChallenge := identityapp.MagicLinkChallenge{
		Email: email, Client: identityapp.PasswordlessClientWeb, ReturnPath: identityapp.PasswordlessReturnPathVaults,
	}
	if err := repository.CreateChallenge(ctx, magicDigest, webChallenge, now.Add(15*time.Minute), nil); err != nil {
		t.Fatalf("persist magic-link challenge: %v", err)
	}
	if challenge, err := repository.ConsumeChallenge(ctx, magicDigest, identityapp.PasswordlessClientPWA, now); err != nil || challenge != nil {
		t.Fatalf("wrong-client challenge redemption = %#v, %v", challenge, err)
	}
	challenge, err := repository.ConsumeChallenge(ctx, magicDigest, identityapp.PasswordlessClientWeb, now)
	if err != nil || challenge == nil || challenge.Email != email || challenge.ReturnPath != identityapp.PasswordlessReturnPathVaults {
		t.Fatalf("valid challenge redemption = %#v, %v", challenge, err)
	}
	if replay, err := repository.ConsumeChallenge(ctx, magicDigest, identityapp.PasswordlessClientWeb, now); err != nil || replay != nil {
		t.Fatalf("challenge replay = %#v, %v; want consumed", replay, err)
	}

	pwaToken := strings.Repeat("p", 43)
	pwaChallenge := identityapp.MagicLinkChallenge{
		Email: email, Client: identityapp.PasswordlessClientPWA, ReturnPath: identityapp.PasswordlessReturnPathInvitationRedeem,
	}
	if err := repository.CreateChallenge(ctx, hmacTestDigest(configuration.MagicLinkSecret, pwaToken), pwaChallenge, now.Add(15*time.Minute), handoff); err != nil {
		t.Fatalf("persist PWA authentication challenge: %v", err)
	}
	account, err := repository.FindOrCreateAccount(ctx, email, now, now)
	if err != nil {
		t.Fatalf("create passwordless account: %v", err)
	}
	registerPasswordlessFixtureCleanup(t, pool, email, account.ApplicationUserID)
	updatedAccount, err := repository.FindOrCreateAccount(ctx, email, now, now.Add(time.Second))
	if err != nil || updatedAccount.ApplicationUserID != account.ApplicationUserID || updatedAccount.Subject != account.Subject {
		t.Fatalf("existing passwordless account update = %#v, %v", updatedAccount, err)
	}
	session, err := repository.CreateSession(ctx, account, now)
	if err != nil {
		t.Fatalf("create passwordless session: %v", err)
	}
	principal, err := repository.VerifyAccessToken(ctx, repository.digestSessionToken(session.AccessToken), now.Add(time.Second))
	if err != nil || principal == nil || principal.SessionID != session.SessionID || principal.Assurance != identityapp.AssuranceActiveSession {
		t.Fatalf("verify passwordless access token = %#v, %v", principal, err)
	}
	browserPrincipal, err := repository.VerifyBrowserSession(ctx, session.SessionID, now.Add(time.Second))
	if err != nil || browserPrincipal == nil || browserPrincipal.Subject != account.Subject {
		t.Fatalf("verify passwordless browser session = %#v, %v", browserPrincipal, err)
	}

	published, err := repository.PublishPWAHandoff(ctx, repository.digestSessionToken(session.RefreshToken), session.SessionID, handoff.IDDigest, now.Add(2*time.Second))
	if err != nil || !published {
		t.Fatalf("publish PWA handoff = %v, %v", published, err)
	}
	pwaSession, returnPath, err := repository.RedeemPWAHandoff(ctx, handoff.IDDigest, handoff.VerifierDigest, now.Add(3*time.Second))
	if err != nil || pwaSession == nil || returnPath != identityapp.PasswordlessReturnPathInvitationRedeem {
		t.Fatalf("redeem PWA handoff = %#v %q %v", pwaSession, returnPath, err)
	}
	if pwaSession.Principal.Subject != account.Subject || pwaSession.RefreshToken == "" {
		t.Fatalf("PWA session does not match the publisher identity: %#v", pwaSession)
	}
	if replay, path, err := repository.RedeemPWAHandoff(ctx, handoff.IDDigest, handoff.VerifierDigest, now.Add(4*time.Second)); err != nil || replay != nil || path != "" {
		t.Fatalf("PWA handoff replay = %#v %q %v; want no session", replay, path, err)
	}

	if err := repository.RevokeSession(ctx, session.SessionID, now.Add(5*time.Second), "logout"); err != nil {
		t.Fatalf("revoke passwordless session: %v", err)
	}
	if revoked, err := repository.VerifyAccessToken(ctx, repository.digestSessionToken(session.AccessToken), now.Add(6*time.Second)); err != nil || revoked != nil {
		t.Fatalf("revoked access token principal = %#v, %v; want nil", revoked, err)
	}
}

func TestPostgresPasswordlessAccountUpdateRejectsMissingRows(t *testing.T) {
	pool := newGoIntegrationPool(t)
	repository, err := NewPostgresPasswordlessAuthRepository(pool, identityapp.PasswordlessConfiguration{
		MagicLinkSecret: []byte(strings.Repeat("m", 32)), SessionSecret: []byte(strings.Repeat("s", 32)),
	})
	if err != nil {
		t.Fatalf("create passwordless repository: %v", err)
	}
	err = repository.updatePasswordlessAccount(context.Background(), "c00000000missinguser", "missing-subject", "dummy@example.test", time.Now().UTC())
	if err == nil || !strings.Contains(err.Error(), "external identity no longer exists") {
		t.Fatalf("account update for missing rows = %v; want fail-closed result", err)
	}
}

func TestPostgresPasswordlessAdmissionRejectsConsumedPreDeletionChallenge(t *testing.T) {
	pool := newGoIntegrationPool(t)
	ctx := context.Background()
	now := time.Now().UTC().Add(time.Minute)
	email := fmt.Sprintf("deletion-race-%d@example.test", now.UnixNano())
	configuration := identityapp.PasswordlessConfiguration{
		MagicLinkSecret: []byte(strings.Repeat("m", 32)), SessionSecret: []byte(strings.Repeat("s", 32)),
	}
	repository, err := NewPostgresPasswordlessAuthRepository(pool, configuration)
	if err != nil {
		t.Fatalf("create passwordless repository: %v", err)
	}
	token := strings.Repeat("d", 43)
	tokenDigest := hmacTestDigest(configuration.MagicLinkSecret, token)
	challenge := identityapp.MagicLinkChallenge{
		Email: email, Client: identityapp.PasswordlessClientWeb, ReturnPath: identityapp.PasswordlessReturnPathVaults,
	}
	if err := repository.CreateChallenge(ctx, tokenDigest, challenge, now.Add(15*time.Minute), nil); err != nil {
		t.Fatalf("create synthetic pre-deletion challenge: %v", err)
	}
	consumed, err := repository.ConsumeChallenge(ctx, tokenDigest, identityapp.PasswordlessClientWeb, now)
	if err != nil || consumed == nil || consumed.CreatedAt.IsZero() {
		t.Fatalf("consume synthetic pre-deletion challenge=%#v err=%v", consumed, err)
	}

	recordID, err := testsupport.NewSyntheticCUID()
	if err != nil {
		t.Fatalf("generate synthetic deletion record ID: %v", err)
	}
	identityID, err := testsupport.NewSyntheticCUID()
	if err != nil {
		t.Fatalf("generate synthetic deletion identity ID: %v", err)
	}
	deletedUserID, err := testsupport.NewSyntheticCUID()
	if err != nil {
		t.Fatalf("generate synthetic deleted user ID: %v", err)
	}
	completedAt := now.Add(time.Second)
	if _, err := pool.Exec(ctx, `
		INSERT INTO account_deletion_records
			(id, application_user_id, email, auth_backend, requested_at, completed_at, email_delivery_status,
			 personal_vault_count, shared_vault_deleted_count, shared_vault_transferred_count, authenticator_account_count)
		VALUES ($1, $2, $3, 'passwordless', $4, $5, 'PENDING', 0, 0, 0, 0)`,
		recordID, deletedUserID, email, now, completedAt); err != nil {
		t.Fatalf("insert synthetic completed deletion record: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO account_deletion_identities (id, deletion_record_id, issuer, subject, deleted_at, normalized_email)
		VALUES ($1, $2, $3, $4, $5, $6)`, identityID, recordID, identityapp.PasswordlessIssuer, "synthetic-deleted-subject", completedAt, email); err != nil {
		t.Fatalf("insert synthetic account-deletion tombstone: %v", err)
	}
	t.Cleanup(func() {
		if _, err := pool.Exec(ctx, `DELETE FROM account_deletion_identities WHERE id = $1`, identityID); err != nil {
			t.Errorf("delete synthetic deletion identity: %v", err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM account_deletion_records WHERE id = $1`, recordID); err != nil {
			t.Errorf("delete synthetic deletion record: %v", err)
		}
	})

	if _, err := repository.FindOrCreateAccount(ctx, email, consumed.CreatedAt, completedAt.Add(time.Second)); !errors.Is(err, identityapp.ErrCredentialInvalidated) {
		t.Fatalf("account admission for consumed pre-deletion challenge=%v; want invalidated credential", err)
	}
	var accountCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM passwordless_identities WHERE normalized_email = $1`, email).Scan(&accountCount); err != nil || accountCount != 0 {
		t.Fatalf("accounts resurrected by pre-deletion challenge=%d err=%v; want 0", accountCount, err)
	}

	freshAccount, err := repository.FindOrCreateAccount(ctx, email, completedAt.Add(time.Second), completedAt.Add(2*time.Second))
	if err != nil || freshAccount.ApplicationUserID == "" {
		t.Fatalf("fresh post-deletion admission=%#v err=%v", freshAccount, err)
	}
	registerPasswordlessFixtureCleanup(t, pool, email, freshAccount.ApplicationUserID)
}

func registerPasswordlessFixtureCleanup(t *testing.T, pool *pgxpool.Pool, email string, userID string) {
	t.Helper()
	t.Cleanup(func() {
		ctx := context.Background()
		if _, err := pool.Exec(ctx, `DELETE FROM pwa_authentication_handoffs WHERE normalized_email = $1`, email); err != nil {
			t.Errorf("delete synthetic PWA handoffs: %v", err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM magic_link_challenges WHERE normalized_email = $1`, email); err != nil {
			t.Errorf("delete synthetic magic-link challenges: %v", err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM application_users WHERE id = $1`, userID); err != nil {
			t.Errorf("delete synthetic passwordless user: %v", err)
		}
	})
}

func hmacTestDigest(secret []byte, value string) []byte {
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(value))
	return mac.Sum(nil)
}
