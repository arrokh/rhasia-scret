package infrastructure

import (
	"context"
	"encoding/base64"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity/application"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

func TestPostgresPasskeyRecoveryRepositoryIntegration(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	repository, err := NewPostgresPasskeyRecoveryRepository(pool, func() time.Time { return now })
	if err != nil {
		t.Fatalf("create passkey recovery repository: %v", err)
	}
	userID := testsupport.CreateSyntheticApplicationUser(t, pool)
	firstRegistrationChallenge := passkeyTestChallenge(1)
	secondRegistrationChallenge := passkeyTestChallenge(2)
	authenticationChallenge := passkeyTestChallenge(3)

	if err := repository.IssueChallenge(ctx, userID, application.PasskeyRecoveryRegistrationPurpose, firstRegistrationChallenge); err != nil {
		t.Fatalf("issue first registration challenge: %v", err)
	}
	if err := repository.IssueChallenge(ctx, userID, application.PasskeyRecoveryAuthenticationPurpose, authenticationChallenge); err != nil {
		t.Fatalf("issue authentication challenge: %v", err)
	}
	if err := repository.IssueChallenge(ctx, userID, application.PasskeyRecoveryRegistrationPurpose, secondRegistrationChallenge); err != nil {
		t.Fatalf("replace registration challenge: %v", err)
	}
	if got := countPasskeyChallenges(t, ctx, pool, userID, string(application.PasskeyRecoveryRegistrationPurpose)); got != 1 {
		t.Fatalf("active registration challenge count=%d; want 1", got)
	}
	consumed, err := repository.ConsumeChallenge(ctx, userID, application.PasskeyRecoveryRegistrationPurpose)
	if err != nil || consumed != secondRegistrationChallenge {
		t.Fatalf("consumed registration challenge=%q, %v; want newest challenge", consumed, err)
	}
	consumed, err = repository.ConsumeChallenge(ctx, userID, application.PasskeyRecoveryRegistrationPurpose)
	if err != nil || consumed != "" {
		t.Fatalf("registration challenge replay=%q, %v; want no challenge", consumed, err)
	}
	consumed, err = repository.ConsumeChallenge(ctx, userID, application.PasskeyRecoveryAuthenticationPurpose)
	if err != nil || consumed != authenticationChallenge {
		t.Fatalf("authentication challenge=%q, %v; want independent challenge", consumed, err)
	}

	expiredChallenge := passkeyTestChallenge(4)
	if err := repository.IssueChallenge(ctx, userID, application.PasskeyRecoveryRegistrationPurpose, expiredChallenge); err != nil {
		t.Fatalf("issue expiring challenge: %v", err)
	}
	now = now.Add(passkeyRecoveryChallengeTTL)
	consumed, err = repository.ConsumeChallenge(ctx, userID, application.PasskeyRecoveryRegistrationPurpose)
	if err != nil || consumed != "" {
		t.Fatalf("challenge at exact expiry=%q, %v; want expired", consumed, err)
	}
	if got := countPasskeyChallenges(t, ctx, pool, userID, string(application.PasskeyRecoveryRegistrationPurpose)); got != 0 {
		t.Fatalf("expired challenge rows remaining=%d; want 0", got)
	}

	concurrentChallenge := passkeyTestChallenge(5)
	if err := repository.IssueChallenge(ctx, userID, application.PasskeyRecoveryRegistrationPurpose, concurrentChallenge); err != nil {
		t.Fatalf("issue concurrent-consumption challenge: %v", err)
	}
	var wait sync.WaitGroup
	results := make(chan string, 2)
	errorsByWorker := make(chan error, 2)
	for range 2 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			value, consumeErr := repository.ConsumeChallenge(ctx, userID, application.PasskeyRecoveryRegistrationPurpose)
			results <- value
			errorsByWorker <- consumeErr
		}()
	}
	wait.Wait()
	close(results)
	close(errorsByWorker)
	var consumedOnce int
	for value := range results {
		if value == concurrentChallenge {
			consumedOnce++
		}
	}
	for consumeErr := range errorsByWorker {
		if consumeErr != nil {
			t.Fatalf("concurrent challenge consumption: %v", consumeErr)
		}
	}
	if consumedOnce != 1 {
		t.Fatalf("concurrent consumers received challenge %d times; want exactly once", consumedOnce)
	}

	insertSyntheticCryptoProfile(t, pool, userID, syntheticProfile())
	credentialID := []byte{1, 2, 3, 4, 5, 6}
	publicKey := []byte{0xa1, 0x01, 0x02}
	recoveryPackage := syntheticEnvelope(1, 32)
	registration := application.PasskeyRecoveryRegistration{
		CredentialID: credentialID, PublicKey: publicKey, Counter: 9,
		Transports: []string{"internal"}, EncryptedRecoveryPackage: recoveryPackage,
	}
	if err := repository.SaveCredential(ctx, userID, registration); err != nil {
		t.Fatalf("save passkey recovery credential: %v", err)
	}
	credential, err := repository.GetCredential(ctx, userID)
	if err != nil || credential == nil || string(credential.CredentialID) != string(credentialID) ||
		string(credential.PublicKey) != string(publicKey) || credential.Counter != 9 ||
		len(credential.Transports) != 1 || credential.Transports[0] != "internal" ||
		string(credential.EncryptedRecoveryPackage) != string(recoveryPackage) {
		t.Fatalf("stored credential=%#v, %v", credential, err)
	}
	credential.Clear()

	if err := repository.SaveCredential(ctx, userID, application.PasskeyRecoveryRegistration{
		CredentialID: []byte{6, 5, 4, 3, 2, 1}, PublicKey: []byte{0xa1, 0x04}, Counter: 0,
		EncryptedRecoveryPackage: syntheticEnvelope(1, 33),
	}); err != nil {
		t.Fatalf("replace credential while transports are omitted: %v", err)
	}
	credential, err = repository.GetCredential(ctx, userID)
	if err != nil || credential == nil || len(credential.Transports) != 1 || credential.Transports[0] != "internal" {
		t.Fatalf("omitted transports did not preserve existing optional value: %#v, %v", credential, err)
	}
	credential.Clear()

	updated, err := repository.UpdateCounter(ctx, userID, []byte{6, 5, 4, 3, 2, 1}, 0, 3)
	if err != nil || !updated {
		t.Fatalf("compare-and-swap counter update=%v, %v; want updated", updated, err)
	}
	updated, err = repository.UpdateCounter(ctx, userID, []byte{6, 5, 4, 3, 2, 1}, 0, 4)
	if err != nil || updated {
		t.Fatalf("stale counter update=%v, %v; want rejected", updated, err)
	}

	secondUserID := testsupport.CreateSyntheticApplicationUser(t, pool)
	insertSyntheticCryptoProfile(t, pool, secondUserID, syntheticProfile())
	if err := repository.SaveCredential(ctx, secondUserID, application.PasskeyRecoveryRegistration{
		CredentialID: []byte{6, 5, 4, 3, 2, 1}, PublicKey: []byte{0xa1, 0x04}, Counter: 0,
		EncryptedRecoveryPackage: syntheticEnvelope(1, 34),
	}); err == nil {
		t.Fatal("duplicate global credential ID was accepted")
	}

	if err := repository.IssueChallenge(ctx, userID, application.PasskeyRecoveryRegistrationPurpose, passkeyTestChallenge(6)); err != nil {
		t.Fatalf("issue challenge before removal: %v", err)
	}
	if err := repository.IssueChallenge(ctx, userID, application.PasskeyRecoveryAuthenticationPurpose, passkeyTestChallenge(7)); err != nil {
		t.Fatalf("issue authentication challenge before removal: %v", err)
	}
	if err := repository.RemoveCredential(ctx, userID); err != nil {
		t.Fatalf("remove passkey recovery credential: %v", err)
	}
	credential, err = repository.GetCredential(ctx, userID)
	if err != nil || credential != nil {
		t.Fatalf("credential after removal=%#v, %v; want nil", credential, err)
	}
	var remainingChallenges int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM passkey_recovery_challenges WHERE user_id = $1`, userID).Scan(&remainingChallenges); err != nil {
		t.Fatalf("count challenges after removal: %v", err)
	}
	if remainingChallenges != 0 {
		t.Fatalf("challenge rows after removal=%d; want 0", remainingChallenges)
	}
	if err := repository.RemoveCredential(ctx, userID); err != nil {
		t.Fatalf("idempotent credential removal: %v", err)
	}
}

func TestPostgresPasskeyRecoveryRequiresCryptoProfileAndValidData(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	repository, err := NewPostgresPasskeyRecoveryRepository(pool, nil)
	if err != nil {
		t.Fatalf("create passkey recovery repository: %v", err)
	}
	userID := testsupport.CreateSyntheticApplicationUser(t, pool)
	registration := application.PasskeyRecoveryRegistration{
		CredentialID: []byte{1, 2, 3, 4}, PublicKey: []byte{0xa1}, Counter: 0,
		EncryptedRecoveryPackage: syntheticEnvelope(1, 16),
	}
	if err := repository.SaveCredential(ctx, userID, registration); err == nil {
		t.Fatal("credential was saved without a crypto profile")
	}
	insertSyntheticCryptoProfile(t, pool, userID, syntheticProfile())
	invalid := registration
	invalid.CredentialID = nil
	if err := repository.SaveCredential(ctx, userID, invalid); err == nil {
		t.Fatal("credential with an empty ID was saved")
	}
	invalid = registration
	invalid.Transports = []string{"internal", "internal"}
	if err := repository.SaveCredential(ctx, userID, invalid); err == nil {
		t.Fatal("credential with duplicate transports was saved")
	}
	if err := repository.IssueChallenge(ctx, userID, application.PasskeyRecoveryPurpose("UNKNOWN"), passkeyTestChallenge(8)); err == nil {
		t.Fatal("challenge with unsupported purpose was issued")
	}
	if err := repository.IssueChallenge(ctx, userID, application.PasskeyRecoveryRegistrationPurpose, "not-base64"); err == nil {
		t.Fatal("malformed challenge was issued")
	}
	if _, err := repository.ConsumeChallenge(ctx, userID, application.PasskeyRecoveryPurpose("UNKNOWN")); err == nil {
		t.Fatal("challenge with unsupported purpose was consumed")
	}
	if _, err := repository.GetCredential(ctx, ""); err == nil {
		t.Fatal("empty user ID was accepted for credential lookup")
	}
	if _, err := repository.UpdateCounter(ctx, userID, registration.CredentialID, -1, 1); err == nil {
		t.Fatal("negative expected counter was accepted")
	}
	if err := repository.RemoveCredential(ctx, ""); err == nil {
		t.Fatal("empty user ID was accepted for credential removal")
	}
}

func countPasskeyChallenges(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string, purpose string) int {
	t.Helper()
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM passkey_recovery_challenges WHERE user_id = $1 AND purpose = $2`, userID, purpose).Scan(&count); err != nil {
		t.Fatalf("count passkey challenges: %v", err)
	}
	return count
}

func passkeyTestChallenge(value byte) string {
	challenge := make([]byte, 32)
	for index := range challenge {
		challenge[index] = value + byte(index)
	}
	return base64.RawURLEncoding.EncodeToString(challenge)
}
