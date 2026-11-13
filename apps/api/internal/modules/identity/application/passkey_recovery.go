package application

import (
	"context"
)

type PasskeyRecoveryPurpose string

const (
	PasskeyRecoveryRegistrationPurpose   PasskeyRecoveryPurpose = "REGISTRATION"
	PasskeyRecoveryAuthenticationPurpose PasskeyRecoveryPurpose = "AUTHENTICATION"
)

type PasskeyRecoveryCredential struct {
	CredentialID             []byte
	PublicKey                []byte
	Counter                  int64
	Transports               []string
	EncryptedRecoveryPackage []byte
}

func (credential *PasskeyRecoveryCredential) Clear() {
	if credential == nil {
		return
	}
	clear(credential.CredentialID)
	clear(credential.PublicKey)
	clear(credential.EncryptedRecoveryPackage)
	clear(credential.Transports)
	credential.CredentialID = nil
	credential.PublicKey = nil
	credential.EncryptedRecoveryPackage = nil
	credential.Transports = nil
	credential.Counter = 0
}

type PasskeyRecoveryRegistration struct {
	CredentialID             []byte
	PublicKey                []byte
	Counter                  int64
	Transports               []string
	EncryptedRecoveryPackage []byte
}

func (registration PasskeyRecoveryRegistration) Clear() {
	clear(registration.CredentialID)
	clear(registration.PublicKey)
	clear(registration.EncryptedRecoveryPackage)
	clear(registration.Transports)
}

type PasskeyRecoveryRepository interface {
	IssueChallenge(context.Context, string, PasskeyRecoveryPurpose, string) error
	ConsumeChallenge(context.Context, string, PasskeyRecoveryPurpose) (string, error)
	GetCredential(context.Context, string) (*PasskeyRecoveryCredential, error)
	SaveCredential(context.Context, string, PasskeyRecoveryRegistration) error
	UpdateCounter(context.Context, string, []byte, int64, int64) (bool, error)
	RemoveCredential(context.Context, string) error
}

func ValidPasskeyRecoveryPurpose(purpose PasskeyRecoveryPurpose) bool {
	return purpose == PasskeyRecoveryRegistrationPurpose || purpose == PasskeyRecoveryAuthenticationPurpose
}
