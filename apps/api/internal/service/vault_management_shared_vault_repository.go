package service

import (
	"context"
	"errors"

	apiEntity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

var (
	ErrSharedVaultIdentityConflict   = errors.New("Shared Vault owner User Encryption identity changed")
	ErrSharedVaultKeyVersionConflict = errors.New("Shared Vault owner key version changed")
)

type NewSharedVault struct {
	ID                     string
	EncryptedName          []byte
	EncryptedOwnerVaultKey []byte
	ExpectedOwnerPublicKey UserEncryptionPublicKey
	EncryptionVersion      int
}

type SharedVaultRepository interface {
	Create(context.Context, string, NewSharedVault) (apiEntity.Vault, error)
	Rename(context.Context, string, string, []byte, int, int64) (bool, error)
	MigrateName(context.Context, string, string, int64, sharedapp.EncryptedPayloadMigration) (sharedapp.EncryptedPayloadMigrationResult, error)
}
