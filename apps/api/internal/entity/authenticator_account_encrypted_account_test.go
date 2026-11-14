package entity

import (
	"testing"
	"time"
)

func TestNewEncryptedAuthenticatorAccountValidatesAndCopiesCiphertext(t *testing.T) {
	for _, input := range []struct {
		id                string
		vaultID           string
		payload           []byte
		encryptionVersion int
		revision          int64
	}{
		{"", "vault", []byte{1}, 1, 1},
		{"account", "", []byte{1}, 1, 1},
		{"account", "vault", nil, 1, 1},
		{"account", "vault", []byte{1}, 0, 1},
		{"account", "vault", []byte{1}, 1, 0},
	} {
		if _, err := NewEncryptedAuthenticatorAccount(input.id, input.vaultID, input.payload, input.encryptionVersion, input.revision); err == nil {
			t.Fatal("accepted invalid encrypted account data")
		}
	}
	input := []byte{1, 2, 3}
	account, err := NewEncryptedAuthenticatorAccount("synthetic-account", "synthetic-vault", input, 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	input[0] = 9
	if account.EncryptedPayload[0] != 1 {
		t.Fatal("account did not copy the encrypted payload")
	}
	account.Clear()
	if len(account.EncryptedPayload) != 0 {
		t.Fatal("account did not release its encrypted payload buffer")
	}
}

func TestAccountRecoveryWindowIsStrictAtDeadline(t *testing.T) {
	deletedAt := time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)
	deadline := AccountPurgeAfter(deletedAt)
	beforeDeadline := deadline.Add(-time.Nanosecond)
	if !AccountCanBeRestored(deletedAt, &deadline, beforeDeadline) {
		t.Fatal("account could not be restored before its purge deadline")
	}
	if AccountCanBeRestored(deletedAt, &deadline, deadline) {
		t.Fatal("account remained restorable at its purge deadline")
	}
	legacyCutoff := deletedAt.Add(AccountRecoveryWindow)
	if AccountCanBeRestored(deletedAt, nil, legacyCutoff) {
		t.Fatal("legacy account remained restorable at its recovery deadline")
	}
}
