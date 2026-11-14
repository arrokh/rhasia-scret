package service

import (
	"context"
	"errors"
	"time"
)

const MaxInvitationRecipientEmailLength = 254

var (
	ErrInvitationRecipientUnavailable   = errors.New("Invitation recipient is unavailable")
	ErrInvitationConflict               = errors.New("Invitation conflicts with current Shared Vault state")
	ErrSecureShareLinkUnavailable       = errors.New("Secure Share Link is unavailable")
	ErrStaleRecipientEncryptionIdentity = errors.New("recipient User Encryption identity is stale")
)

type NewSecureShareLink struct {
	LinkVerifier       []byte
	EncryptedPackage   []byte
	ExpectedKeyVersion int64
}

type CreatedSecureShareLink struct {
	ID        string
	ExpiresAt time.Time
}

type RedeemableSecureShareLink struct {
	ID               string
	VaultID          string
	EncryptedPackage []byte
	KeyVersion       int64
}

type SecureShareLinkRecipient struct {
	UserID string
	Email  string
}

type SecureShareLinkRepository interface {
	CreateForEmail(context.Context, string, string, string, NewSecureShareLink) (CreatedSecureShareLink, error)
	FindForRecipient(context.Context, SecureShareLinkRecipient, []byte) (*RedeemableSecureShareLink, error)
	Redeem(context.Context, SecureShareLinkRecipient, string, []byte, int64, UserEncryptionPublicKey) error
}
