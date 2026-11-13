package application

import "testing"

func TestValidateEncryptedPayloadMigration(t *testing.T) {
	expected := make([]byte, 64)
	expected[0] = 1
	replacement := make([]byte, 65)
	replacement[0] = 2
	replacementDigest := SHA256Base64URL(replacement)
	migration := EncryptedPayloadMigration{
		ExpectedEnvelopeVersion:     1,
		ReplacementEnvelopeVersion:  2,
		ExpectedCiphertextDigest:    SHA256Base64URL(expected),
		ReplacementCiphertextDigest: replacementDigest,
		ReplacementCiphertext:       replacement,
		OperationID:                 replacementDigest,
	}
	if !ValidateEncryptedPayloadMigration(migration) {
		t.Fatal("rejected a valid encrypted payload migration")
	}
	migration.OperationID = "unstable"
	if ValidateEncryptedPayloadMigration(migration) {
		t.Fatal("accepted an unstable migration operation ID")
	}
	migration.OperationID = replacementDigest
	migration.ReplacementCiphertextDigest = "A" + replacementDigest[1:]
	if ValidateEncryptedPayloadMigration(migration) {
		t.Fatal("accepted a replacement digest that did not match ciphertext")
	}
}
