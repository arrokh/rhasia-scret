package infrastructure

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/identity"
)

type PublicEncryptionKeyQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

type PublicEncryptionKeyRowsQueryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

func ReadUserEncryptionPublicKeys(ctx context.Context, queryer PublicEncryptionKeyRowsQueryer, userIDs []string) (map[string]*identityapp.UserEncryptionPublicKey, error) {
	if queryer == nil {
		return nil, errors.New("User Encryption public key reader is not configured")
	}
	keys := make(map[string]*identityapp.UserEncryptionPublicKey, len(userIDs))
	if len(userIDs) == 0 {
		return keys, nil
	}
	rows, err := queryer.Query(ctx, `
		SELECT user_id, user_encryption_public_key
		FROM user_crypto_profiles
		WHERE user_id = ANY($1::text[])`, userIDs)
	if err != nil {
		return nil, fmt.Errorf("read User Encryption public keys: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var userID string
		var raw json.RawMessage
		if err := rows.Scan(&userID, &raw); err != nil {
			return nil, fmt.Errorf("scan User Encryption public key: %w", err)
		}
		key, err := identityapp.ParseUserEncryptionPublicKey(raw)
		if err != nil {
			keys[userID] = nil
			continue
		}
		keys[userID] = &key
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate User Encryption public keys: %w", err)
	}
	return keys, nil
}

func MatchesUserEncryptionPublicKey(
	ctx context.Context,
	queryer PublicEncryptionKeyQueryer,
	userID string,
	expected identityapp.UserEncryptionPublicKey,
) (bool, error) {
	if queryer == nil || userID == "" || identityapp.ValidateUserEncryptionPublicKey(expected) != nil {
		return false, errors.New("User Encryption public key lookup is invalid")
	}
	var current json.RawMessage
	err := queryer.QueryRow(ctx, `
		SELECT user_encryption_public_key
		FROM user_crypto_profiles
		WHERE user_id = $1`, userID).Scan(&current)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("read User Encryption public key: %w", err)
	}
	stored, err := identityapp.ParseUserEncryptionPublicKey(current)
	if err != nil {
		return false, nil
	}
	return identityapp.PublicEncryptionKeysEqual(stored, expected), nil
}
