package identity

import (
	"context"

	identityrepository "github.com/nooroctavian/rhasia-scret/apps/api/internal/repository/identity"
)

type PostgreSQLQueryer = identityrepository.PostgreSQLQueryer
type PostgreSQLExecutor = identityrepository.PostgreSQLExecutor

func HasPasskeyRecoveryCredential(ctx context.Context, queryer PostgreSQLQueryer, userID string) (bool, error) {
	return identityrepository.HasPasskeyRecoveryCredential(ctx, queryer, userID)
}

func DeleteUserCryptoProfileAndPasskeyChallenges(ctx context.Context, executor PostgreSQLExecutor, userID string) error {
	return identityrepository.DeleteUserCryptoProfileAndPasskeyChallenges(ctx, executor, userID)
}
