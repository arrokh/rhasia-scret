package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

func LockPasswordlessEmail(ctx context.Context, transaction pgx.Tx, email string) error {
	normalizedEmail := strings.ToLower(strings.TrimSpace(email))
	if transaction == nil || normalizedEmail == "" {
		return errors.New("passwordless email lock request is invalid")
	}
	if _, err := transaction.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, "rhasia:passwordless-email:"+normalizedEmail); err != nil {
		return fmt.Errorf("lock passwordless account email: %w", err)
	}
	return nil
}
