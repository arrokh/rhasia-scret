package identity

import (
	"context"

	identityrepository "github.com/nooroctavian/rhasia-scret/apps/api/internal/repository/identity"
	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/identity"
)

type PublicEncryptionKey = identityapp.UserEncryptionPublicKey
type PublicEncryptionKeyQueryer = identityrepository.PublicEncryptionKeyQueryer
type PublicEncryptionKeyRowsQueryer = identityrepository.PublicEncryptionKeyRowsQueryer

func ParsePublicEncryptionKey(raw []byte) (PublicEncryptionKey, error) {
	return identityapp.ParseUserEncryptionPublicKey(raw)
}

func ValidatePublicEncryptionKey(key PublicEncryptionKey) error {
	return identityapp.ValidateUserEncryptionPublicKey(key)
}

func ReadUserEncryptionPublicKeys(ctx context.Context, queryer PublicEncryptionKeyRowsQueryer, userIDs []string) (map[string]*PublicEncryptionKey, error) {
	return identityrepository.ReadUserEncryptionPublicKeys(ctx, queryer, userIDs)
}

func MatchesUserEncryptionPublicKey(
	ctx context.Context,
	queryer PublicEncryptionKeyQueryer,
	userID string,
	expected PublicEncryptionKey,
) (bool, error) {
	return identityrepository.MatchesUserEncryptionPublicKey(ctx, queryer, userID, expected)
}

func PublicEncryptionKeysEqual(left, right PublicEncryptionKey) bool {
	return identityapp.PublicEncryptionKeysEqual(left, right)
}
