package service

import (
	"context"
	"errors"
)

type PersonalVaultInitialization struct {
	VaultUnlockSalt           []byte
	WrappedUserRootKey        []byte
	EncryptedPersonalVaultKey []byte
	EncryptedVaultName        []byte
	UserEncryptionPublicKey   UserEncryptionPublicKey
	EncryptedUserPrivateKey   []byte
	UserEncryptionKeyVersion  int
	EncryptionVersion         int
}

type PersonalVaultInitializer interface {
	Initialize(context.Context, string, PersonalVaultInitialization) error
}

type PersonalVaultInitializationService struct {
	initializer PersonalVaultInitializer
}

func NewPersonalVaultInitializationService(initializer PersonalVaultInitializer) *PersonalVaultInitializationService {
	return &PersonalVaultInitializationService{initializer: initializer}
}

func (service *PersonalVaultInitializationService) Initialize(ctx context.Context, ownerID string, initialization PersonalVaultInitialization) error {
	if ownerID == "" {
		return errors.New("application user is required to initialize a Personal Vault")
	}
	if initialization.EncryptionVersion != 1 || initialization.UserEncryptionKeyVersion != 1 {
		return errors.New("unsupported Personal Vault encryption version")
	}
	if err := ValidateUserEncryptionPublicKey(initialization.UserEncryptionPublicKey); err != nil {
		return errors.New("Personal Vault public encryption key is invalid")
	}
	return service.initializer.Initialize(ctx, ownerID, initialization)
}
