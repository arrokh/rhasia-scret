package service

import (
	"context"
	"encoding/json"
)

type EncryptedUserCryptoProfile struct {
	VaultUnlockSalt           []byte
	WrappedUserRootKey        []byte
	EncryptedPersonalVaultKey []byte
	EncryptionVersion         int
	UserEncryptionPublicKey   json.RawMessage
	EncryptedUserPrivateKey   []byte
}

type UserRootKeyRewrap struct {
	VaultUnlockSalt           []byte
	WrappedUserRootKey        []byte
	EncryptedPersonalVaultKey []byte
	EncryptionVersion         int
}

type UserCryptoProfileWrapperMigration struct {
	ExpectedCiphertext    []byte
	ReplacementCiphertext []byte
}

type UserCryptoProfileMigration struct {
	WrappedUserRootKey        *UserCryptoProfileWrapperMigration
	EncryptedPersonalVaultKey *UserCryptoProfileWrapperMigration
}

type UserCryptoProfileMigrationResult string

const (
	UserCryptoProfileMigrationCommitted        UserCryptoProfileMigrationResult = "committed"
	UserCryptoProfileMigrationAlreadyCommitted UserCryptoProfileMigrationResult = "already-committed"
	UserCryptoProfileMigrationConflict         UserCryptoProfileMigrationResult = "conflict"
)

type UserCryptoProfileRepository interface {
	Get(context.Context, string) (*EncryptedUserCryptoProfile, error)
	RewrapUserRootKey(context.Context, string, UserRootKeyRewrap) error
	MigrateUserCryptoProfile(context.Context, string, UserCryptoProfileMigration) (UserCryptoProfileMigrationResult, error)
}

type UserCryptoProfileService struct {
	repository UserCryptoProfileRepository
}

func NewUserCryptoProfileService(repository UserCryptoProfileRepository) *UserCryptoProfileService {
	return &UserCryptoProfileService{repository: repository}
}

func (service *UserCryptoProfileService) Get(ctx context.Context, userID string) (*EncryptedUserCryptoProfile, error) {
	return service.repository.Get(ctx, userID)
}

func (service *UserCryptoProfileService) RewrapUserRootKey(ctx context.Context, userID string, rewrap UserRootKeyRewrap) error {
	return service.repository.RewrapUserRootKey(ctx, userID, rewrap)
}

func (service *UserCryptoProfileService) MigrateUserCryptoProfile(ctx context.Context, userID string, migration UserCryptoProfileMigration) (UserCryptoProfileMigrationResult, error) {
	return service.repository.MigrateUserCryptoProfile(ctx, userID, migration)
}
