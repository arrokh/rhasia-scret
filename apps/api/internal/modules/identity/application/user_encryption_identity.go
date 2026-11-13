package application

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
)

type UserEncryptionPublicKey struct {
	Kty    string    `json:"kty"`
	Crv    string    `json:"crv"`
	X      string    `json:"x"`
	Y      string    `json:"y"`
	Ext    *bool     `json:"ext,omitempty"`
	KeyOps *[]string `json:"key_ops,omitempty"`
}

func ParseUserEncryptionPublicKey(raw []byte) (UserEncryptionPublicKey, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
		return UserEncryptionPublicKey{}, errors.New("public encryption key is invalid")
	}
	for name := range fields {
		switch name {
		case "kty", "crv", "x", "y", "ext", "key_ops":
		default:
			return UserEncryptionPublicKey{}, errors.New("public encryption key is invalid")
		}
	}
	key := UserEncryptionPublicKey{}
	if err := decodeRequiredJSONString(fields, "kty", &key.Kty); err != nil || key.Kty != "EC" {
		return UserEncryptionPublicKey{}, errors.New("public encryption key is invalid")
	}
	if err := decodeRequiredJSONString(fields, "crv", &key.Crv); err != nil || key.Crv != "P-256" {
		return UserEncryptionPublicKey{}, errors.New("public encryption key is invalid")
	}
	if err := decodeRequiredJSONString(fields, "x", &key.X); err != nil || !validPublicKeyCoordinate(key.X) {
		return UserEncryptionPublicKey{}, errors.New("public encryption key is invalid")
	}
	if err := decodeRequiredJSONString(fields, "y", &key.Y); err != nil || !validPublicKeyCoordinate(key.Y) {
		return UserEncryptionPublicKey{}, errors.New("public encryption key is invalid")
	}
	if rawExt, ok := fields["ext"]; ok {
		if bytes.Equal(bytes.TrimSpace(rawExt), []byte("null")) {
			return UserEncryptionPublicKey{}, errors.New("public encryption key is invalid")
		}
		var ext bool
		if err := json.Unmarshal(rawExt, &ext); err != nil {
			return UserEncryptionPublicKey{}, errors.New("public encryption key is invalid")
		}
		key.Ext = &ext
	}
	if rawKeyOps, ok := fields["key_ops"]; ok {
		if bytes.Equal(bytes.TrimSpace(rawKeyOps), []byte("null")) {
			return UserEncryptionPublicKey{}, errors.New("public encryption key is invalid")
		}
		var operations []json.RawMessage
		if err := json.Unmarshal(rawKeyOps, &operations); err != nil || operations == nil || len(operations) > 8 {
			return UserEncryptionPublicKey{}, errors.New("public encryption key is invalid")
		}
		values := make([]string, len(operations))
		for index, operation := range operations {
			if bytes.Equal(bytes.TrimSpace(operation), []byte("null")) {
				return UserEncryptionPublicKey{}, errors.New("public encryption key is invalid")
			}
			if err := json.Unmarshal(operation, &values[index]); err != nil {
				return UserEncryptionPublicKey{}, errors.New("public encryption key is invalid")
			}
		}
		key.KeyOps = &values
	}
	return key, nil
}

func ValidateUserEncryptionPublicKey(key UserEncryptionPublicKey) error {
	serialized, err := json.Marshal(key)
	if err != nil {
		return errors.New("public encryption key is invalid")
	}
	_, err = ParseUserEncryptionPublicKey(serialized)
	return err
}

func decodeRequiredJSONString(fields map[string]json.RawMessage, name string, target *string) error {
	raw, ok := fields[name]
	if !ok || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return errors.New("public encryption key is invalid")
	}
	if err := json.Unmarshal(raw, target); err != nil {
		return errors.New("public encryption key is invalid")
	}
	return nil
}

func validPublicKeyCoordinate(value string) bool {
	if len(value) != 43 {
		return false
	}
	for _, character := range value {
		if !(character >= 'A' && character <= 'Z') && !(character >= 'a' && character <= 'z') &&
			!(character >= '0' && character <= '9') && character != '_' && character != '-' {
			return false
		}
	}
	return true
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
