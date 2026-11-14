package application

import (
	"context"

	vaultdomain "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity/vault-management"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

type PersonalVaultRepository interface {
	EnsureForOwner(context.Context, string) (vaultdomain.Vault, error)
	MigrateName(context.Context, string, string, int64, sharedapp.EncryptedPayloadMigration) (sharedapp.EncryptedPayloadMigrationResult, error)
}
