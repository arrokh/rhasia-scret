package infrastructure

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type PostgreSQLQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

type PostgreSQLExecutor interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func HasPasskeyRecoveryCredential(ctx context.Context, queryer PostgreSQLQueryer, userID string) (bool, error) {
	var exists bool
	if err := queryer.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM passkey_recovery_credentials WHERE user_id = $1)`, userID).Scan(&exists); err != nil {
		return false, fmt.Errorf("check Passkey-Assisted Recovery enrollment: %w", err)
	}
	return exists, nil
}

func DeleteUserCryptoProfileAndPasskeyChallenges(ctx context.Context, executor PostgreSQLExecutor, userID string) error {
	if _, err := executor.Exec(ctx, `DELETE FROM user_crypto_profiles WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("delete User Crypto Profile: %w", err)
	}
	if _, err := executor.Exec(ctx, `DELETE FROM passkey_recovery_challenges WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("delete pending Passkey-Assisted Recovery challenges: %w", err)
	}
	return nil
}
