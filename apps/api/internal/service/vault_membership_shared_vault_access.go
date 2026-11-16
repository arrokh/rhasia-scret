package service

import (
	"context"

	apiEntity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

type SharedVaultAccountAccess struct {
	ID                string
	EncryptedPayload  []byte
	EncryptionVersion int
	Revision          int64
}

type SharedVaultAccess struct {
	VaultID                     string
	Role                        apiEntity.SharedVaultMemberRole
	EffectiveAccountPermissions apiEntity.EffectiveSharedVaultAccountPermissions
	EncryptedName               []byte
	EncryptionVersion           int
	EncryptedVaultKey           []byte
	KeyVersion                  int64
	Accounts                    []SharedVaultAccountAccess
}

type SharedVaultAccessRepository interface {
	ListForMember(context.Context, string) ([]SharedVaultAccess, error)
	GetForMember(context.Context, string, string) (*SharedVaultAccess, error)
	MigrateKeyWrap(context.Context, string, string, int64, sharedapp.EncryptedPayloadMigration) (sharedapp.EncryptedPayloadMigrationResult, error)
}
