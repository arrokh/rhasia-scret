package repository

import (
	"context"
	"errors"
	"fmt"
	"net"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
)

func TestSessionVerifierRetriesTransientConnectionFailure(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 11, 17, 3, 0, 0, 0, time.UTC)
	database := &retryTestSessionDatabase{
		now: now,
		firstError: &net.OpError{
			Op:  "dial",
			Net: "tcp",
			Err: errors.New("connection refused"),
		},
	}
	verifier := retryTestVerifier(t, database, now)
	assertion := signedAssertion(t, verifier.sessionSecret, map[string]any{
		"session_id": "0123456789abcdef0123456789abcdef",
		"iss":        assertionIssuer,
		"aud":        assertionAudience,
		"iat":        now.Add(-time.Minute).Unix(),
		"exp":        now.Add(time.Minute).Unix(),
	})

	principal, err := verifier.Verify(context.Background(), apiService.SessionCredentials{
		CookieHeader: passwordlessAssertion + "=" + assertion,
		TrustedProxy: true,
	}, apiService.AssuranceActiveSession)
	if err != nil || principal == nil || principal.Subject != "synthetic-subject" {
		t.Fatalf("Verify() = %#v, %v; want recovered synthetic principal", principal, err)
	}
	if database.attempts != 2 {
		t.Fatalf("database query attempts = %d; want one retry", database.attempts)
	}
}

func TestSessionVerifierRecognizesPGXNetworkConnectionFailures(t *testing.T) {
	t.Parallel()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve synthetic database port: %v", err)
	}
	address := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatalf("release synthetic database port: %v", err)
	}

	config, err := pgxpool.ParseConfig(fmt.Sprintf("postgresql://synthetic:synthetic@%s/synthetic?sslmode=disable", address))
	if err != nil {
		t.Fatalf("parse synthetic database URL: %v", err)
	}
	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		t.Fatalf("create synthetic pgxpool: %v", err)
	}
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := pool.Ping(ctx); err == nil {
		t.Fatal("Ping() error = nil; want connection refusal")
	} else if !isRetryableSessionReadError(err) {
		t.Fatal("pgxpool connection refusal was not classified for one safe session-read retry")
	}
}

func TestSessionVerifierDoesNotRetrySchemaErrors(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 11, 17, 3, 0, 0, 0, time.UTC)
	database := &retryTestSessionDatabase{now: now, persistentError: &pgconn.PgError{Code: "42P01", Message: "synthetic missing relation"}}
	verifier := retryTestVerifier(t, database, now)
	assertion := signedAssertion(t, verifier.sessionSecret, map[string]any{
		"session_id": "0123456789abcdef0123456789abcdef",
		"iss":        assertionIssuer,
		"aud":        assertionAudience,
		"iat":        now.Add(-time.Minute).Unix(),
		"exp":        now.Add(time.Minute).Unix(),
	})

	principal, err := verifier.Verify(context.Background(), apiService.SessionCredentials{
		CookieHeader: passwordlessAssertion + "=" + assertion,
		TrustedProxy: true,
	}, apiService.AssuranceActiveSession)
	if err == nil || principal != nil {
		t.Fatalf("Verify() = %#v, %v; want schema error", principal, err)
	}
	if database.attempts != 1 {
		t.Fatalf("database query attempts = %d; want no retry for schema errors", database.attempts)
	}
}

func TestSessionVerifierCapsTransientConnectionRetries(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 11, 17, 3, 0, 0, 0, time.UTC)
	database := &retryTestSessionDatabase{
		now: now,
		persistentError: &net.OpError{
			Op:  "dial",
			Net: "tcp",
			Err: errors.New("connection refused"),
		},
	}
	verifier := retryTestVerifier(t, database, now)
	assertion := signedAssertion(t, verifier.sessionSecret, map[string]any{
		"session_id": "0123456789abcdef0123456789abcdef",
		"iss":        assertionIssuer,
		"aud":        assertionAudience,
		"iat":        now.Add(-time.Minute).Unix(),
		"exp":        now.Add(time.Minute).Unix(),
	})

	if _, err := verifier.Verify(context.Background(), apiService.SessionCredentials{
		CookieHeader: passwordlessAssertion + "=" + assertion,
		TrustedProxy: true,
	}, apiService.AssuranceActiveSession); err == nil {
		t.Fatal("Verify() error = nil; want persistent connection error")
	}
	if database.attempts != 2 {
		t.Fatalf("database query attempts = %d; want exactly two", database.attempts)
	}
}

type retryTestSessionDatabase struct {
	now             time.Time
	attempts        int
	firstError      error
	persistentError error
}

func (database *retryTestSessionDatabase) QueryRow(context.Context, string, ...any) pgx.Row {
	database.attempts++
	if database.persistentError != nil {
		return retryTestSessionRow{err: database.persistentError}
	}
	if database.attempts == 1 && database.firstError != nil {
		return retryTestSessionRow{err: database.firstError}
	}
	return retryTestSessionRow{values: []any{
		"0123456789abcdef0123456789abcdef",
		database.now.Add(time.Hour),
		database.now.Add(-time.Minute),
		passwordlessIssuer,
		"synthetic-subject",
		"person@example.test",
		database.now.Add(-time.Minute),
	}}
}

func (database *retryTestSessionDatabase) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, errors.New("unexpected session activity update")
}

type retryTestSessionRow struct {
	values []any
	err    error
}

func (row retryTestSessionRow) Scan(destinations ...any) error {
	if row.err != nil {
		return row.err
	}
	if len(destinations) != len(row.values) {
		return errors.New("unexpected session query projection")
	}
	for index, destination := range destinations {
		switch typed := destination.(type) {
		case *string:
			value, ok := row.values[index].(string)
			if !ok {
				return errors.New("unexpected string projection value")
			}
			*typed = value
		case *time.Time:
			value, ok := row.values[index].(time.Time)
			if !ok {
				return errors.New("unexpected time projection value")
			}
			*typed = value
		default:
			return errors.New("unexpected session query destination")
		}
	}
	return nil
}

func retryTestVerifier(t *testing.T, database *retryTestSessionDatabase, now time.Time) *SessionVerifier {
	t.Helper()
	return &SessionVerifier{
		pool:          database,
		sessionSecret: []byte("synthetic-session-secret-with-at-least-32-bytes"),
		now:           func() time.Time { return now },
	}
}
