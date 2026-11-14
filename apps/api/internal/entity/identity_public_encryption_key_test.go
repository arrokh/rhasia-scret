package entity

import (
	"strings"
	"testing"
)

func TestPublicEncryptionKeyComparisonPreservesOptionalFieldSemantics(t *testing.T) {
	base, err := ParseUserEncryptionPublicKey([]byte(`{"kty":"EC","crv":"P-256","x":"` + strings.Repeat("A", 43) + `","y":"` + strings.Repeat("B", 43) + `"}`))
	if err != nil {
		t.Fatalf("parse synthetic public key: %v", err)
	}
	if !PublicEncryptionKeysEqual(base, base) {
		t.Fatal("identical public keys do not match")
	}
	falseValue := false
	withExplicitFalse := base
	withExplicitFalse.Ext = &falseValue
	if PublicEncryptionKeysEqual(base, withExplicitFalse) {
		t.Fatal("missing optional ext field matched explicit false")
	}
	emptyOperations := []string{}
	withEmptyOperations := base
	withEmptyOperations.KeyOps = &emptyOperations
	if PublicEncryptionKeysEqual(base, withEmptyOperations) {
		t.Fatal("missing optional key_ops field matched an explicit empty list")
	}
	withSameOperations := base
	sameEmptyOperations := []string{}
	withSameOperations.KeyOps = &sameEmptyOperations
	if !PublicEncryptionKeysEqual(withEmptyOperations, withSameOperations) {
		t.Fatal("equal explicit empty key_ops lists do not match")
	}
}
