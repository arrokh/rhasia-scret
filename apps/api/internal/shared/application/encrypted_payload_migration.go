package application

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
)

const MaxEncryptedPayloadBytes = 16*1024 + 29

type EncryptedPayloadMigration struct {
	ExpectedEnvelopeVersion     int
	ReplacementEnvelopeVersion  int
	ExpectedCiphertextDigest    string
	ReplacementCiphertextDigest string
	ReplacementCiphertext       []byte
	OperationID                 string
}

type EncryptedPayloadMigrationResult string

const (
	EncryptedPayloadMigrationCommitted        EncryptedPayloadMigrationResult = "committed"
	EncryptedPayloadMigrationAlreadyCommitted EncryptedPayloadMigrationResult = "already-committed"
	EncryptedPayloadMigrationConflict         EncryptedPayloadMigrationResult = "conflict"
)

func HasSHA256Base64URLDigestShape(value string) bool {
	if len(value) != 43 {
		return false
	}
	for index := 0; index < len(value); index++ {
		character := value[index]
		if character >= 'A' && character <= 'Z' || character >= 'a' && character <= 'z' ||
			character >= '0' && character <= '9' || character == '_' || character == '-' {
			continue
		}
		return false
	}
	return true
}

func IsCanonicalSHA256Base64URLDigest(value string) bool {
	if !HasSHA256Base64URLDigestShape(value) {
		return false
	}
	decoded, err := base64.RawURLEncoding.Strict().DecodeString(value)
	if err != nil || len(decoded) != sha256.Size || base64.RawURLEncoding.EncodeToString(decoded) != value {
		clear(decoded)
		return false
	}
	clear(decoded)
	return true
}

func SHA256Base64URL(value []byte) string {
	digest := sha256.Sum256(value)
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

func ValidateEncryptedPayloadMigration(migration EncryptedPayloadMigration) bool {
	replacement := migration.ReplacementCiphertext
	if migration.ExpectedEnvelopeVersion != 1 || migration.ReplacementEnvelopeVersion != 2 ||
		!HasSHA256Base64URLDigestShape(migration.ExpectedCiphertextDigest) ||
		!HasSHA256Base64URLDigestShape(migration.ReplacementCiphertextDigest) ||
		!constantTimeStringEqual(migration.OperationID, migration.ReplacementCiphertextDigest) ||
		len(replacement) < 29 || len(replacement) > MaxEncryptedPayloadBytes || replacement[0] != 2 {
		return false
	}
	return constantTimeStringEqual(SHA256Base64URL(replacement), migration.ReplacementCiphertextDigest)
}

func constantTimeStringEqual(left string, right string) bool {
	if len(left) != len(right) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(left), []byte(right)) == 1
}
