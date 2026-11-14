package service

import (
	"context"

	apiEntity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

type PersonalVaultRepository interface {
	EnsureForOwner(context.Context, string) (apiEntity.Vault, error)
	MigrateName(context.Context, string, string, int64, sharedapp.EncryptedPayloadMigration) (sharedapp.EncryptedPayloadMigrationResult, error)
}
