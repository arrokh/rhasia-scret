package service

import (
	"context"

	apiEntity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

type AccountCopySource string

const AccountCopySourceLocalVault AccountCopySource = "LOCAL_VAULT_COPY"

type NewEncryptedAccount struct {
	EncryptedPayload  []byte
	EncryptionVersion int
	Source            AccountCopySource
}

type PersonalAccountRepository interface {
	Create(context.Context, string, string, NewEncryptedAccount) (apiEntity.EncryptedAuthenticatorAccount, error)
	List(context.Context, string, string) ([]apiEntity.EncryptedAuthenticatorAccount, error)
	MigratePayload(context.Context, string, string, string, int64, int64, sharedapp.EncryptedPayloadMigration) (sharedapp.EncryptedPayloadMigrationResult, error)
	Update(context.Context, string, string, string, int64, NewEncryptedAccount) (*apiEntity.EncryptedAuthenticatorAccount, error)
	Delete(context.Context, string, string, string, int64) (bool, error)
	Restore(context.Context, string, string, string) (bool, error)
}
