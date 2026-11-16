package repository

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/postgres"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

func TestApplicationRateLimiterEnforcesSharedLimitAcrossConcurrentInstances(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	userID := createApplicationRateLimiterUser(t, pool)
	first, err := NewApplicationRateLimiter(pool)
	if err != nil {
		t.Fatalf("create first application rate limiter: %v", err)
	}
	second, err := NewApplicationRateLimiter(pool)
	if err != nil {
		t.Fatalf("create second application rate limiter: %v", err)
	}

	const requestCount = 20
	decisions := make(chan bool, requestCount)
	errCh := make(chan error, requestCount)
	var workers sync.WaitGroup
	workers.Add(requestCount)
	for index := 0; index < requestCount; index++ {
		limiter := first
		if index%2 != 0 {
			limiter = second
		}
		go func(limiter *ApplicationRateLimiter) {
			defer workers.Done()
			decision, consumeErr := limiter.Consume(context.Background(), userID, "destructive_mutation")
			if consumeErr != nil {
				errCh <- consumeErr
				return
			}
			if decision.RetryAfterSeconds < 1 || decision.RetryAfterSeconds > 3600 {
				errCh <- fmt.Errorf("retry-after %d is outside the one-hour window", decision.RetryAfterSeconds)
				return
			}
			decisions <- decision.Allowed
		}(limiter)
	}
	workers.Wait()
	close(decisions)
	close(errCh)
	for consumeErr := range errCh {
		t.Fatalf("consume concurrent application rate limit: %v", consumeErr)
	}

	allowed := 0
	denied := 0
	for result := range decisions {
		if result {
			allowed++
			continue
		}
		denied++
	}
	if allowed != 5 || denied != 15 {
		t.Fatalf("concurrent decisions allowed=%d denied=%d; want 5/15", allowed, denied)
	}

	var persistedCount int32
	if err := pool.QueryRow(context.Background(), `
		SELECT request_count FROM application_rate_limit_windows
		WHERE user_id = $1 AND operation = 'destructive_mutation'`, userID).Scan(&persistedCount); err != nil {
		t.Fatalf("read persisted application rate limit: %v", err)
	}
	if persistedCount != 6 {
		t.Fatalf("persisted request count=%d; want limit plus one", persistedCount)
	}
}

func TestApplicationRateLimiterPrunesExpiredWindowsAndIsolatesBudgets(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	firstUser := createApplicationRateLimiterUser(t, pool)
	secondUser := createApplicationRateLimiterUser(t, pool)
	limiter, err := NewApplicationRateLimiter(pool)
	if err != nil {
		t.Fatalf("create application rate limiter: %v", err)
	}

	now := time.Now().UTC()
	for _, window := range []struct {
		operation string
		expiresAt time.Time
	}{
		{operation: "old_synthetic_operation", expiresAt: now.Add(-49 * time.Hour)},
		{operation: "recent_synthetic_operation", expiresAt: now.Add(-2 * time.Hour)},
	} {
		if _, err := pool.Exec(context.Background(), `
			INSERT INTO application_rate_limit_windows (user_id, operation, window_started_at, expires_at, request_count)
			VALUES ($1, $2, $3, $4, 1)`, firstUser, window.operation, window.expiresAt.Add(-time.Hour), window.expiresAt); err != nil {
			t.Fatalf("insert synthetic rate-limit window: %v", err)
		}
	}

	decision, err := limiter.Consume(context.Background(), firstUser, "audit_event")
	if err != nil || !decision.Allowed {
		t.Fatalf("consume audit-event rate limit: %#v, %v", decision, err)
	}
	for _, test := range []struct {
		operation string
		wantCount int
	}{
		{operation: "old_synthetic_operation", wantCount: 0},
		{operation: "recent_synthetic_operation", wantCount: 1},
		{operation: "audit_event", wantCount: 1},
	} {
		var count int
		if err := pool.QueryRow(context.Background(), `
			SELECT COUNT(*) FROM application_rate_limit_windows
			WHERE user_id = $1 AND operation = $2`, firstUser, test.operation).Scan(&count); err != nil {
			t.Fatalf("count %s windows: %v", test.operation, err)
		}
		if count != test.wantCount {
			t.Errorf("%s windows=%d; want %d", test.operation, count, test.wantCount)
		}
	}

	for index := 0; index < 6; index++ {
		decision, err = limiter.Consume(context.Background(), firstUser, "destructive_mutation")
		if err != nil {
			t.Fatalf("consume first user's destructive budget: %v", err)
		}
		if decision.Allowed != (index < 5) {
			t.Errorf("first user request %d allowed=%t; want %t", index+1, decision.Allowed, index < 5)
		}
	}
	for _, test := range []struct {
		userID    string
		operation string
	}{
		{userID: firstUser, operation: "vault_mutation"},
		{userID: secondUser, operation: "destructive_mutation"},
	} {
		decision, err = limiter.Consume(context.Background(), test.userID, test.operation)
		if err != nil || !decision.Allowed {
			t.Errorf("independent budget user=%s operation=%s decision=%#v err=%v", test.userID, test.operation, decision, err)
		}
	}
}

func createApplicationRateLimiterUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	userID, err := postgres.NewCUID()
	if err != nil {
		t.Fatalf("generate synthetic rate-limit user ID: %v", err)
	}
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO application_users (id, email, status, created_at, updated_at)
		VALUES ($1, $2, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, userID, userID+"@example.test"); err != nil {
		t.Fatalf("create synthetic rate-limit user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM application_users WHERE id = $1`, userID)
	})
	return userID
}
