package repository

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const anonymousAuthWindowSeconds int64 = 15 * 60

type AnonymousAuthRateLimitResult struct {
	Allowed           bool
	RetryAfterSeconds int
}

type anonymousAuthRateLimitBucket struct {
	operation string
	value     string
	maximum   int32
}

type AnonymousAuthRateLimiter struct {
	pool   *pgxpool.Pool
	secret []byte
}

func NewAnonymousAuthRateLimiter(pool *pgxpool.Pool, secret []byte) (*AnonymousAuthRateLimiter, error) {
	if pool == nil || len(secret) < 32 {
		return nil, fmt.Errorf("anonymous authentication limiter is not configured")
	}
	return &AnonymousAuthRateLimiter{pool: pool, secret: append([]byte(nil), secret...)}, nil
}

func (limiter *AnonymousAuthRateLimiter) Check(ctx context.Context, email string, clientIP string, now time.Time) (AnonymousAuthRateLimitResult, error) {
	ipBucket := anonymousAuthRateLimitBucket{operation: "magic-link-unattributed", value: "all-untrusted-clients", maximum: 20}
	if clientIP != "" {
		ipBucket = anonymousAuthRateLimitBucket{operation: "magic-link-ip", value: clientIP, maximum: 20}
	}
	buckets := []anonymousAuthRateLimitBucket{
		{operation: "magic-link-email", value: email, maximum: 5},
		ipBucket,
	}
	results := make([]AnonymousAuthRateLimitResult, len(buckets))
	errorsByIndex := make([]error, len(buckets))
	var workers sync.WaitGroup
	workers.Add(len(buckets))
	for index, bucket := range buckets {
		index := index
		bucket := bucket
		go func() {
			defer workers.Done()
			results[index], errorsByIndex[index] = limiter.increment(ctx, bucket, now)
		}()
	}
	workers.Wait()
	for _, err := range errorsByIndex {
		if err != nil {
			return AnonymousAuthRateLimitResult{}, err
		}
	}
	for _, result := range results {
		if !result.Allowed {
			return result, nil
		}
	}
	return AnonymousAuthRateLimitResult{Allowed: true}, nil
}

func (limiter *AnonymousAuthRateLimiter) increment(ctx context.Context, bucket anonymousAuthRateLimitBucket, now time.Time) (AnonymousAuthRateLimitResult, error) {
	windowStartUnix := now.Unix() / anonymousAuthWindowSeconds * anonymousAuthWindowSeconds
	windowStartedAt := time.Unix(windowStartUnix, 0).UTC()
	expiresAt := windowStartedAt.Add(time.Duration(anonymousAuthWindowSeconds) * time.Second)
	bucketHash := hmac.New(sha256.New, limiter.secret)
	_, _ = bucketHash.Write([]byte(bucket.operation + ":" + bucket.value))
	var requestCount int32
	err := limiter.pool.QueryRow(ctx, `
		INSERT INTO anonymous_auth_rate_limit_windows (
			bucket_hash, operation, window_started_at, expires_at, request_count
		)
		VALUES ($1, $2, $3, $4, 1)
		ON CONFLICT (bucket_hash, operation, window_started_at)
		DO UPDATE SET request_count = anonymous_auth_rate_limit_windows.request_count + 1
		RETURNING request_count`, bucketHash.Sum(nil), bucket.operation, windowStartedAt, expiresAt).Scan(&requestCount)
	if err != nil {
		return AnonymousAuthRateLimitResult{}, fmt.Errorf("consume anonymous authentication rate limit: %w", err)
	}
	retryAfter := int(math.Ceil(expiresAt.Sub(now).Seconds()))
	if retryAfter < 1 {
		retryAfter = 1
	}
	return AnonymousAuthRateLimitResult{Allowed: requestCount <= bucket.maximum, RetryAfterSeconds: retryAfter}, nil
}
