package service

import (
	"context"
	"encoding/json"

	apiEntity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity"
)

type UserEncryptionPublicKey = apiEntity.UserEncryptionPublicKey

func ParseUserEncryptionPublicKey(raw []byte) (UserEncryptionPublicKey, error) {
	return apiEntity.ParseUserEncryptionPublicKey(raw)
}

func ValidateUserEncryptionPublicKey(key UserEncryptionPublicKey) error {
	return apiEntity.ValidateUserEncryptionPublicKey(key)
}

func PublicEncryptionKeysEqual(left, right UserEncryptionPublicKey) bool {
	return apiEntity.PublicEncryptionKeysEqual(left, right)
}

type UserEncryptionIdentity struct {
	PublicKey           UserEncryptionPublicKey
	EncryptedPrivateKey []byte
	EncryptionVersion   int
}

type UserEncryptionPrivateKeyMigration struct {
	ExpectedEnvelopeVersion     int
	ReplacementEnvelopeVersion  int
	UserEncryptionKeyVersion    int
	ExpectedCiphertextDigest    string
	ReplacementCiphertextDigest string
	EncryptedPrivateKey         []byte
	OperationID                 string
}

type UserEncryptionPrivateKeyMigrationResult string

const (
	UserEncryptionPrivateKeyMigrationCommitted        UserEncryptionPrivateKeyMigrationResult = "committed"
	UserEncryptionPrivateKeyMigrationAlreadyCommitted UserEncryptionPrivateKeyMigrationResult = "already-committed"
	UserEncryptionPrivateKeyMigrationConflict         UserEncryptionPrivateKeyMigrationResult = "conflict"
)

type UserEncryptionIdentityRepository interface {
	Register(context.Context, string, UserEncryptionIdentity) (bool, error)
	MigratePrivateKey(context.Context, string, UserEncryptionPrivateKeyMigration) (UserEncryptionPrivateKeyMigrationResult, error)
}

type UserEncryptionIdentityService struct {
	repository UserEncryptionIdentityRepository
}

func NewUserEncryptionIdentityService(repository UserEncryptionIdentityRepository) *UserEncryptionIdentityService {
	return &UserEncryptionIdentityService{repository: repository}
}

func (service *UserEncryptionIdentityService) Register(ctx context.Context, userID string, identity UserEncryptionIdentity) (bool, error) {
	return service.repository.Register(ctx, userID, identity)
}

func (service *UserEncryptionIdentityService) MigratePrivateKey(ctx context.Context, userID string, migration UserEncryptionPrivateKeyMigration) (UserEncryptionPrivateKeyMigrationResult, error) {
	return service.repository.MigratePrivateKey(ctx, userID, migration)
}

type UserEncryptionIdentityRotationMembership struct {
	VaultID             string
	OwnerID             string
	EncryptedVaultKey   []byte
	KeyVersion          int
	ExpectedKeyVersion  int
	ExpectedVaultKey    []byte
	ReplacementVaultKey []byte
}

type UserEncryptionIdentityRotationSnapshot struct {
	PublicKey           json.RawMessage
	EncryptedPrivateKey []byte
	EncryptionVersion   int
	Memberships         []UserEncryptionIdentityRotationMembership
}

type UserEncryptionIdentityRotation struct {
	ExpectedPublicKey           UserEncryptionPublicKey
	ExpectedEncryptedPrivateKey []byte
	ExpectedEncryptionVersion   int
	PublicKey                   UserEncryptionPublicKey
	EncryptedPrivateKey         []byte
	EncryptionVersion           int
	Memberships                 []UserEncryptionIdentityRotationMembership
}

type UserEncryptionIdentityRotationRepository interface {
	Snapshot(context.Context, string) (*UserEncryptionIdentityRotationSnapshot, error)
	Rotate(context.Context, string, UserEncryptionIdentityRotation) (bool, error)
}

type UserEncryptionIdentityRotationService struct {
	repository UserEncryptionIdentityRotationRepository
}

func NewUserEncryptionIdentityRotationService(repository UserEncryptionIdentityRotationRepository) *UserEncryptionIdentityRotationService {
	return &UserEncryptionIdentityRotationService{repository: repository}
}

func (service *UserEncryptionIdentityRotationService) Snapshot(ctx context.Context, userID string) (*UserEncryptionIdentityRotationSnapshot, error) {
	return service.repository.Snapshot(ctx, userID)
}

func (service *UserEncryptionIdentityRotationService) Rotate(ctx context.Context, userID string, rotation UserEncryptionIdentityRotation) (bool, error) {
	return service.repository.Rotate(ctx, userID, rotation)
}
