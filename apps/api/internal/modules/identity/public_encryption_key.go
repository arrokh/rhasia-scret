package identity

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"

	"github.com/jackc/pgx/v5"

	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity/application"
)

type PublicEncryptionKey = identityapp.UserEncryptionPublicKey

type PublicEncryptionKeyQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

type PublicEncryptionKeyRowsQueryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

func ParsePublicEncryptionKey(raw []byte) (PublicEncryptionKey, error) {
	return identityapp.ParseUserEncryptionPublicKey(raw)
}

func ValidatePublicEncryptionKey(key PublicEncryptionKey) error {
	return identityapp.ValidateUserEncryptionPublicKey(key)
}

func ReadUserEncryptionPublicKeys(ctx context.Context, queryer PublicEncryptionKeyRowsQueryer, userIDs []string) (map[string]*PublicEncryptionKey, error) {
	if queryer == nil {
		return nil, errors.New("User Encryption public key reader is not configured")
	}
	keys := make(map[string]*PublicEncryptionKey, len(userIDs))
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
	expected PublicEncryptionKey,
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
	return PublicEncryptionKeysEqual(stored, expected), nil
}

func PublicEncryptionKeysEqual(left, right PublicEncryptionKey) bool {
	return left.Kty == right.Kty && left.Crv == right.Crv && left.X == right.X && left.Y == right.Y &&
		reflect.DeepEqual(left.Ext, right.Ext) && reflect.DeepEqual(left.KeyOps, right.KeyOps)
}
