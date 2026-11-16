package entity

import (
	"errors"
)

type EncryptedAuthenticatorAccount struct {
	ID                string
	VaultID           string
	EncryptedPayload  []byte
	EncryptionVersion int
	Revision          int64
}

func NewEncryptedAuthenticatorAccount(id string, vaultID string, encryptedPayload []byte, encryptionVersion int, revision int64) (EncryptedAuthenticatorAccount, error) {
	if id == "" || vaultID == "" || len(encryptedPayload) == 0 {
		return EncryptedAuthenticatorAccount{}, errors.New("encrypted account identity and payload are required")
	}
	if encryptionVersion < 1 {
		return EncryptedAuthenticatorAccount{}, errors.New("an encryption version is required")
	}
	if revision < 1 {
		return EncryptedAuthenticatorAccount{}, errors.New("Account Revision must be positive")
	}
	return EncryptedAuthenticatorAccount{
		ID:                id,
		VaultID:           vaultID,
		EncryptedPayload:  append([]byte(nil), encryptedPayload...),
		EncryptionVersion: encryptionVersion,
		Revision:          revision,
	}, nil
}

func (account *EncryptedAuthenticatorAccount) Clear() {
	if account == nil {
		return
	}
	clear(account.EncryptedPayload)
	account.EncryptedPayload = nil
}
