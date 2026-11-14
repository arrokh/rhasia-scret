package infrastructure

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/identity"
)

type RateLimitPolicy struct {
	Limit         int32
	WindowSeconds int32
}

var applicationRateLimitPolicies = map[string]RateLimitPolicy{
	"account_mutation":                {Limit: 120, WindowSeconds: 60},
	"account_deletion_authentication": {Limit: 10, WindowSeconds: 600},
	"archive_export":                  {Limit: 10, WindowSeconds: 3600},
	"archive_import":                  {Limit: 10, WindowSeconds: 3600},
	"audit_event":                     {Limit: 120, WindowSeconds: 60},
	"destructive_mutation":            {Limit: 5, WindowSeconds: 3600},
	"key_material_mutation":           {Limit: 10, WindowSeconds: 300},
	"membership_mutation":             {Limit: 30, WindowSeconds: 60},
	"recovery_authentication":         {Limit: 30, WindowSeconds: 300},
	"recovery_mutation":               {Limit: 10, WindowSeconds: 600},
	"vault_mutation":                  {Limit: 30, WindowSeconds: 60},
}

type PostgresApplicationRateLimiter struct {
	pool *pgxpool.Pool
}

func NewPostgresApplicationRateLimiter(pool *pgxpool.Pool) (*PostgresApplicationRateLimiter, error) {
	if pool == nil {
		return nil, errors.New("application rate limiter is not configured")
	}
	return &PostgresApplicationRateLimiter{pool: pool}, nil
}

func (limiter *PostgresApplicationRateLimiter) Consume(ctx context.Context, userID string, operation string) (identityapp.RateLimitDecision, error) {
	policy, ok := applicationRateLimitPolicies[operation]
	if !ok || userID == "" {
		return identityapp.RateLimitDecision{}, errors.New("application rate-limit policy is invalid")
	}
	transaction, err := limiter.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return identityapp.RateLimitDecision{}, fmt.Errorf("begin application rate-limit transaction: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()

	if _, err := transaction.Exec(ctx, `
		DELETE FROM application_rate_limit_windows
		WHERE ctid IN (
			SELECT ctid
			FROM application_rate_limit_windows
			WHERE expires_at < clock_timestamp() - INTERVAL '24 hours'
			ORDER BY expires_at
			LIMIT 1000
		)`); err != nil {
		return identityapp.RateLimitDecision{}, fmt.Errorf("prune application rate-limit windows: %w", err)
	}

	var requestCount int32
	var retryAfterSeconds int32
	err = transaction.QueryRow(ctx, `
		WITH rate_window AS (
			SELECT to_timestamp(
				floor(extract(epoch FROM clock_timestamp()) / $3) * $3
			)::timestamp AS started_at
		), consumed AS (
			INSERT INTO application_rate_limit_windows (
				user_id, operation, window_started_at, expires_at, request_count
			)
			SELECT $1, $2, started_at, started_at + make_interval(secs => $3), 1
			FROM rate_window
			ON CONFLICT (user_id, operation, window_started_at)
			DO UPDATE SET request_count = LEAST(
				application_rate_limit_windows.request_count + 1,
				$4
			)
			RETURNING request_count, expires_at
		)
		SELECT request_count,
		       GREATEST(1, CEIL(extract(epoch FROM (expires_at - clock_timestamp()))))::integer
		FROM consumed`, userID, operation, policy.WindowSeconds, policy.Limit+1).Scan(&requestCount, &retryAfterSeconds)
	if err != nil {
		return identityapp.RateLimitDecision{}, fmt.Errorf("consume application rate limit: %w", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return identityapp.RateLimitDecision{}, fmt.Errorf("commit application rate limit: %w", err)
	}
	return identityapp.RateLimitDecision{Allowed: requestCount <= policy.Limit, RetryAfterSeconds: int(retryAfterSeconds)}, nil
}

var _ identityapp.RateLimiter = (*PostgresApplicationRateLimiter)(nil)
