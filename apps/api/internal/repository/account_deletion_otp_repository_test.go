package repository

import (
	"context"
	"crypto/subtle"
	"errors"
	"regexp"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

var syntheticDeletionOTPPattern = regexp.MustCompile(`^[0-9]{6}$`)

func TestPasswordlessOTPChallengeLifecycle(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	userID := testsupport.CreateSyntheticApplicationUser(t, pool)
	repository, err := NewPasswordlessOTPRepository(pool, []byte("synthetic-session-secret-with-enough-length"))
	if err != nil {
		t.Fatalf("create passwordless OTP repository: %v", err)
	}
	defer repository.Close()
	now := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)

	t.Run("replaces open challenges and verifies exactly once", func(t *testing.T) {
		firstChallenge, err := repository.CreatePasswordlessOTPChallenge(ctx, userID, now)
		if err != nil {
			t.Fatalf("create first passwordless challenge: %v", err)
		}
		if !syntheticDeletionOTPPattern.MatchString(firstChallenge.OTP) {
			t.Fatal("generated passwordless OTP did not have six ASCII digits")
		}
		secondChallenge, err := repository.CreatePasswordlessOTPChallenge(ctx, userID, now.Add(time.Second))
		if err != nil {
			t.Fatalf("replace passwordless challenge: %v", err)
		}
		var openCount int
		if err := pool.QueryRow(ctx, `
			SELECT COUNT(*) FROM account_deletion_challenges
			WHERE application_user_id = $1 AND purpose = 'PASSWORDLESS_OTP'
			AND verified_at IS NULL AND consumed_at IS NULL`, userID).Scan(&openCount); err != nil {
			t.Fatalf("count open challenges: %v", err)
		}
		if openCount != 1 {
			t.Fatalf("open challenge count=%d; want 1", openCount)
		}
		token, err := repository.VerifyPasswordlessOTP(ctx, userID, secondChallenge.OTP, now.Add(2*time.Second))
		if err != nil {
			t.Fatalf("verify synthetic passwordless OTP: %v", err)
		}
		if len(token) != 43 {
			t.Fatalf("authorization token length=%d; want 43", len(token))
		}
		var verifiedAt, consumedAt *time.Time
		var storedOTP []byte
		if err := pool.QueryRow(ctx, `
			SELECT otp_digest, verified_at, consumed_at
			FROM account_deletion_challenges
			WHERE id = $1`, secondChallenge.ID).Scan(&storedOTP, &verifiedAt, &consumedAt); err != nil {
			t.Fatalf("read challenge lifecycle: %v", err)
		}
		if len(storedOTP) != 32 || string(storedOTP) == secondChallenge.OTP || verifiedAt == nil || consumedAt == nil {
			t.Fatal("challenge did not persist only a digest and consume OTP on verification")
		}
		var storedAuthorizationDigest []byte
		if err := pool.QueryRow(ctx, `SELECT authorization_digest FROM account_deletion_challenges WHERE id = $1`, secondChallenge.ID).Scan(&storedAuthorizationDigest); err != nil {
			t.Fatalf("read authorization digest: %v", err)
		}
		expectedAuthorizationDigest := repository.digest(accountDeletionAuthorizationContext, token)
		if len(storedAuthorizationDigest) != len(expectedAuthorizationDigest) || subtle.ConstantTimeCompare(storedAuthorizationDigest, expectedAuthorizationDigest) != 1 {
			t.Fatal("persisted authorization digest does not match returned cookie token")
		}
		clear(expectedAuthorizationDigest)
		clear(storedAuthorizationDigest)
		if _, err := repository.VerifyPasswordlessOTP(ctx, userID, secondChallenge.OTP, now.Add(3*time.Second)); !errors.Is(err, apiService.ErrPasswordlessOTPExpired) {
			t.Fatalf("reused passwordless OTP error=%v; want unavailable", err)
		}
	})

	t.Run("counts failed attempts and locks the challenge", func(t *testing.T) {
		challenge, err := repository.CreatePasswordlessOTPChallenge(ctx, userID, now.Add(time.Minute))
		if err != nil {
			t.Fatalf("create challenge for attempt limit: %v", err)
		}
		wrongOTP := "000000"
		if challenge.OTP == wrongOTP {
			wrongOTP = "000001"
		}
		for attempt := 0; attempt < apiService.PasswordlessOTPAttemptLimit; attempt++ {
			_, err := repository.VerifyPasswordlessOTP(ctx, userID, wrongOTP, now.Add(time.Minute+time.Second))
			if !errors.Is(err, apiService.ErrPasswordlessOTPInvalid) {
				t.Fatalf("invalid attempt %d error=%v; want invalid OTP", attempt+1, err)
			}
		}
		if _, err := repository.VerifyPasswordlessOTP(ctx, userID, wrongOTP, now.Add(time.Minute+time.Second)); !errors.Is(err, apiService.ErrPasswordlessOTPLocked) {
			t.Fatalf("locked challenge error=%v; want locked", err)
		}
		var attempts int
		if err := pool.QueryRow(ctx, `
			SELECT attempt_count FROM account_deletion_challenges
			WHERE id = $1`, challenge.ID).Scan(&attempts); err != nil {
			t.Fatalf("read attempt count: %v", err)
		}
		if attempts != apiService.PasswordlessOTPAttemptLimit {
			t.Fatalf("persisted attempt count=%d; want limit %d", attempts, apiService.PasswordlessOTPAttemptLimit)
		}
	})

	t.Run("expires after ten minutes", func(t *testing.T) {
		challenge, err := repository.CreatePasswordlessOTPChallenge(ctx, userID, now.Add(2*time.Minute))
		if err != nil {
			t.Fatalf("create expiring challenge: %v", err)
		}
		_, err = repository.VerifyPasswordlessOTP(ctx, userID, challenge.OTP, now.Add(13*time.Minute))
		if !errors.Is(err, apiService.ErrPasswordlessOTPExpired) {
			t.Fatalf("expired challenge error=%v; want unavailable", err)
		}
	})

	t.Run("serializes concurrent verification", func(t *testing.T) {
		challenge, err := repository.CreatePasswordlessOTPChallenge(ctx, userID, now.Add(20*time.Minute))
		if err != nil {
			t.Fatalf("create challenge for concurrent verification: %v", err)
		}
		var wait sync.WaitGroup
		wait.Add(2)
		results := make(chan error, 2)
		for range 2 {
			go func() {
				defer wait.Done()
				_, err := repository.VerifyPasswordlessOTP(ctx, userID, challenge.OTP, now.Add(21*time.Minute))
				results <- err
			}()
		}
		wait.Wait()
		close(results)
		successes := 0
		for err := range results {
			if err == nil {
				successes++
				continue
			}
			if !errors.Is(err, apiService.ErrPasswordlessOTPExpired) {
				t.Fatalf("concurrent verification error=%v; want one-time unavailable", err)
			}
		}
		if successes != 1 {
			t.Fatalf("concurrent verification successes=%d; want exactly one", successes)
		}
	})
}

func TestPasswordlessOTPRepositoryRequiresSecretAndPool(t *testing.T) {
	if _, err := NewPasswordlessOTPRepository(nil, []byte("synthetic-session-secret-long-enough")); err == nil {
		t.Fatal("repository accepted nil database pool")
	}
	if _, err := NewPasswordlessOTPRepository(&pgxpool.Pool{}, []byte("too-short")); err == nil {
		t.Fatal("repository accepted short session secret")
	}
}
