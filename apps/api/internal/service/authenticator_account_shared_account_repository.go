package service

import (
	"context"

	apiEntity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

type SharedAccountMutationStatus string

const (
	SharedAccountMutationSuccess            SharedAccountMutationStatus = "SUCCESS"
	SharedAccountMutationVaultUnavailable   SharedAccountMutationStatus = "VAULT_UNAVAILABLE"
	SharedAccountMutationPermissionDenied   SharedAccountMutationStatus = "PERMISSION_DENIED"
	SharedAccountMutationStaleRevision      SharedAccountMutationStatus = "STALE_REVISION"
	SharedAccountMutationStaleKeyVersion    SharedAccountMutationStatus = "STALE_KEY_VERSION"
	SharedAccountMutationAccountUnavailable SharedAccountMutationStatus = "ACCOUNT_UNAVAILABLE"
)

type SharedAccountMutationResult struct {
	Status  SharedAccountMutationStatus
	Account *apiEntity.EncryptedAuthenticatorAccount
}

type SharedAccountRepository interface {
	Create(context.Context, string, string, []byte, int, int64) (SharedAccountMutationResult, error)
	MigratePayload(context.Context, string, string, string, int64, int64, sharedapp.EncryptedPayloadMigration) (sharedapp.EncryptedPayloadMigrationResult, error)
	Update(context.Context, string, string, string, int64, []byte, int, int64) (SharedAccountMutationResult, error)
	Delete(context.Context, string, string, string, int64) (SharedAccountMutationResult, error)
	Restore(context.Context, string, string, string) (SharedAccountMutationResult, error)
}
