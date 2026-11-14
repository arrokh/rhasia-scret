package infrastructure

import (
	"testing"

	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/identity"
)

func TestPasskeyRecoveryCredentialIDBoundsFollowWebAuthn(t *testing.T) {
	registration := identityapp.PasskeyRecoveryRegistration{
		CredentialID: make([]byte, 1), PublicKey: []byte{1}, EncryptedRecoveryPackage: make([]byte, 13),
	}
	if !validPasskeyRecoveryRegistration(registration) {
		t.Fatal("accepted WebAuthn credential ID minimum was rejected")
	}
	registration.CredentialID = make([]byte, maxPasskeyRecoveryCredentialIDBytes)
	if !validPasskeyRecoveryRegistration(registration) {
		t.Fatal("WebAuthn credential ID maximum was rejected")
	}
	registration.CredentialID = make([]byte, maxPasskeyRecoveryCredentialIDBytes+1)
	if validPasskeyRecoveryRegistration(registration) {
		t.Fatal("credential ID larger than WebAuthn maximum was accepted")
	}
	registration.CredentialID = nil
	if validPasskeyRecoveryRegistration(registration) {
		t.Fatal("empty credential ID was accepted")
	}
	registration.Clear()
}
