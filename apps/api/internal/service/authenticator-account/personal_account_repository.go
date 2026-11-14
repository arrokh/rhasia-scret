package application

import (
	"context"

	accountdomain "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity/authenticator-account"
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
	Create(context.Context, string, string, NewEncryptedAccount) (accountdomain.EncryptedAuthenticatorAccount, error)
	List(context.Context, string, string) ([]accountdomain.EncryptedAuthenticatorAccount, error)
	MigratePayload(context.Context, string, string, string, int64, int64, sharedapp.EncryptedPayloadMigration) (sharedapp.EncryptedPayloadMigrationResult, error)
	Update(context.Context, string, string, string, int64, NewEncryptedAccount) (*accountdomain.EncryptedAuthenticatorAccount, error)
	Delete(context.Context, string, string, string, int64) (bool, error)
	Restore(context.Context, string, string, string) (bool, error)
}
