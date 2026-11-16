package service

import (
	"context"
	"time"
)

const (
	MaxVaultKeyRotationAccounts       = 500
	MaxVaultKeyRotationMemberPackages = 500
)

type VaultKeyRotationAccountSnapshot struct {
	ID                string
	EncryptedPayload  []byte
	EncryptionVersion int
	Revision          int64
	DeletedAt         *time.Time
}

type VaultKeyRotationMemberSnapshot struct {
	UserID     string
	KeyVersion *int64
	PublicKey  *UserEncryptionPublicKey
}

type VaultKeyRotationSnapshot struct {
	VaultID                string
	EncryptedName          []byte
	EncryptionVersion      int
	CurrentKeyVersion      *int64
	PendingInvitationCount int
	Accounts               []VaultKeyRotationAccountSnapshot
	Members                []VaultKeyRotationMemberSnapshot
}

type VaultKeyRotationAccountReplacement struct {
	ID               string
	Revision         int64
	EncryptedPayload []byte
}

type VaultKeyRotationMemberPackage struct {
	UserID            string
	ExpectedPublicKey UserEncryptionPublicKey
	EncryptedVaultKey []byte
}

type VaultKeyRotation struct {
	ExpectedEncryptedName []byte
	EncryptedName         []byte
	EncryptionVersion     int
	ExpectedKeyVersion    int64
	KeyVersion            int64
	Accounts              []VaultKeyRotationAccountReplacement
	MemberPackages        []VaultKeyRotationMemberPackage
}

type VaultKeyRotationRepository interface {
	Snapshot(context.Context, string, string) (*VaultKeyRotationSnapshot, error)
	Rotate(context.Context, string, string, VaultKeyRotation) (bool, error)
}
