package infrastructure

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"testing"
	"time"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/postgres"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

func TestPostgresAnonymousAuthRateLimiterBoundsEmailAndStoresOnlyHMACBuckets(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	secret := []byte("synthetic-anonymous-rate-limit-secret")
	limiter, err := NewPostgresAnonymousAuthRateLimiter(pool, secret)
	if err != nil {
		t.Fatalf("create anonymous rate limiter: %v", err)
	}
	suffix, err := postgres.NewCUID()
	if err != nil {
		t.Fatalf("generate synthetic email suffix: %v", err)
	}
	email := suffix + "@example.test"
	otherSuffix, err := postgres.NewCUID()
	if err != nil {
		t.Fatalf("generate second synthetic email suffix: %v", err)
	}
	otherEmail := otherSuffix + "@example.test"
	clientIP := "203.0.113.7"
	now := time.Date(2026, time.November, 10, 0, 0, 1, 0, time.UTC)
	windowStartedAt := time.Unix(now.Unix()/anonymousAuthWindowSeconds*anonymousAuthWindowSeconds, 0).UTC()
	nextWindow := now.Add(time.Duration(anonymousAuthWindowSeconds) * time.Second)
	newWindowStartedAt := time.Unix(nextWindow.Unix()/anonymousAuthWindowSeconds*anonymousAuthWindowSeconds, 0).UTC()
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `
			DELETE FROM anonymous_auth_rate_limit_windows
			WHERE window_started_at IN ($1, $2) AND (
				(operation = 'magic-link-email' AND bucket_hash IN ($3, $4)) OR
				(operation = 'magic-link-ip' AND bucket_hash = $5)
			)`, windowStartedAt, newWindowStartedAt,
			anonymousBucketHash(secret, "magic-link-email:"+email),
			anonymousBucketHash(secret, "magic-link-email:"+otherEmail),
			anonymousBucketHash(secret, "magic-link-ip:"+clientIP))
	})

	for attempt := 1; attempt <= 6; attempt++ {
		decision, err := limiter.Check(context.Background(), email, clientIP, now)
		if err != nil {
			t.Fatalf("check synthetic anonymous rate limit: %v", err)
		}
		if decision.Allowed != (attempt <= 5) {
			t.Errorf("attempt %d allowed=%t; want %t", attempt, decision.Allowed, attempt <= 5)
		}
		if !decision.Allowed && (decision.RetryAfterSeconds < 1 || decision.RetryAfterSeconds > int(anonymousAuthWindowSeconds)) {
			t.Errorf("attempt %d retry-after=%d is outside the fixed window", attempt, decision.RetryAfterSeconds)
		}
	}

	var emailHash []byte
	var emailCount int32
	if err := pool.QueryRow(context.Background(), `
		SELECT bucket_hash, request_count FROM anonymous_auth_rate_limit_windows
		WHERE operation = 'magic-link-email' AND window_started_at = $1`, windowStartedAt).Scan(&emailHash, &emailCount); err != nil {
		t.Fatalf("read synthetic email rate-limit bucket: %v", err)
	}
	if emailCount != 6 || !bytes.Equal(emailHash, anonymousBucketHash(secret, "magic-link-email:"+email)) || bytes.Equal(emailHash, []byte(email)) {
		t.Fatalf("email bucket count=%d hash length=%d; expected six requests and only its HMAC", emailCount, len(emailHash))
	}
	var ipCount int32
	if err := pool.QueryRow(context.Background(), `
		SELECT request_count FROM anonymous_auth_rate_limit_windows
		WHERE operation = 'magic-link-ip' AND window_started_at = $1`, windowStartedAt).Scan(&ipCount); err != nil {
		t.Fatalf("read synthetic IP rate-limit bucket: %v", err)
	}
	if ipCount != 6 {
		t.Fatalf("IP bucket count=%d; want 6", ipCount)
	}

	decision, err := limiter.Check(context.Background(), otherEmail, clientIP, now)
	if err != nil || !decision.Allowed {
		t.Fatalf("separate email exceeded the shared IP budget: decision=%#v err=%v", decision, err)
	}

	decision, err = limiter.Check(context.Background(), email, clientIP, nextWindow)
	if err != nil || !decision.Allowed {
		t.Fatalf("new fixed window did not reset the email budget: decision=%#v err=%v", decision, err)
	}
	var newWindowCount int32
	if err := pool.QueryRow(context.Background(), `
		SELECT request_count FROM anonymous_auth_rate_limit_windows
		WHERE operation = 'magic-link-email' AND window_started_at = $1`, newWindowStartedAt).Scan(&newWindowCount); err != nil {
		t.Fatalf("read next-window email bucket: %v", err)
	}
	if newWindowCount != 1 {
		t.Fatalf("new-window email count=%d; want 1", newWindowCount)
	}
}

func TestPostgresAnonymousAuthRateLimiterSharesUntrustedClientFallbackBucket(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	secret := []byte("synthetic-anonymous-rate-limit-secret")
	limiter, err := NewPostgresAnonymousAuthRateLimiter(pool, secret)
	if err != nil {
		t.Fatalf("create anonymous rate limiter: %v", err)
	}
	firstEmail := "first@example.test"
	secondEmail := "second@example.test"
	now := time.Date(2026, time.November, 10, 0, 5, 1, 0, time.UTC)
	windowStartedAt := time.Unix(now.Unix()/anonymousAuthWindowSeconds*anonymousAuthWindowSeconds, 0).UTC()
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `
			DELETE FROM anonymous_auth_rate_limit_windows
			WHERE window_started_at = $1 AND bucket_hash IN ($2, $3, $4)`, windowStartedAt,
			anonymousBucketHash(secret, "magic-link-email:"+firstEmail),
			anonymousBucketHash(secret, "magic-link-email:"+secondEmail),
			anonymousBucketHash(secret, "magic-link-unattributed:all-untrusted-clients"))
	})

	for _, email := range []string{firstEmail, secondEmail} {
		decision, err := limiter.Check(context.Background(), email, "", now)
		if err != nil || !decision.Allowed {
			t.Fatalf("unattributed request for synthetic email was denied: decision=%#v err=%v", decision, err)
		}
	}

	var bucketHash []byte
	var requestCount int32
	if err := pool.QueryRow(context.Background(), `
		SELECT bucket_hash, request_count FROM anonymous_auth_rate_limit_windows
		WHERE operation = 'magic-link-unattributed' AND window_started_at = $1`, windowStartedAt).Scan(&bucketHash, &requestCount); err != nil {
		t.Fatalf("read shared unattributed bucket: %v", err)
	}
	if requestCount != 2 || !bytes.Equal(bucketHash, anonymousBucketHash(secret, "magic-link-unattributed:all-untrusted-clients")) {
		t.Fatalf("unattributed bucket count=%d hash length=%d; want shared, key-derived counter 2", requestCount, len(bucketHash))
	}
	var leakedEmails int
	if err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM anonymous_auth_rate_limit_windows
		WHERE operation IN ('magic-link-email', 'magic-link-unattributed')
			AND (bucket_hash = $1 OR bucket_hash = $2)`, []byte("first@example.test"), []byte("second@example.test")).Scan(&leakedEmails); err != nil {
		t.Fatalf("check anonymous bucket privacy: %v", err)
	}
	if leakedEmails != 0 {
		t.Fatalf("raw email value appeared in %d persisted rate-limit buckets", leakedEmails)
	}
}

func anonymousBucketHash(secret []byte, value string) []byte {
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(value))
	return mac.Sum(nil)
}
