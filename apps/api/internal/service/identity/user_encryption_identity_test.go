package application

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestParseUserEncryptionPublicKey(t *testing.T) {
	validKey := `{"kty":"EC","crv":"P-256","x":"` + strings.Repeat("A", 43) + `","y":"` + strings.Repeat("B", 43) + `"}`
	tests := []struct {
		name    string
		input   string
		wantErr bool
	}{
		{name: "valid public key", input: validKey},
		{name: "valid optional public metadata", input: `{"kty":"EC","crv":"P-256","x":"` + strings.Repeat("A", 43) + `","y":"` + strings.Repeat("B", 43) + `","ext":false,"key_ops":[]}`},
		{name: "reject private key material", input: strings.TrimSuffix(validKey, "}") + `,"d":"synthetic-private-key"}`, wantErr: true},
		{name: "reject unsupported curve", input: strings.Replace(validKey, "P-256", "P-384", 1), wantErr: true},
		{name: "reject malformed coordinate", input: strings.Replace(validKey, strings.Repeat("A", 43), strings.Repeat("A", 42)+"=", 1), wantErr: true},
		{name: "reject null optional boolean", input: strings.TrimSuffix(validKey, "}") + `,"ext":null}`, wantErr: true},
		{name: "reject null key operations", input: strings.TrimSuffix(validKey, "}") + `,"key_ops":null}`, wantErr: true},
		{name: "reject non-string key operation", input: strings.TrimSuffix(validKey, "}") + `,"key_ops":[null]}`, wantErr: true},
		{name: "reject too many key operations", input: strings.TrimSuffix(validKey, "}") + `,"key_ops":["a","b","c","d","e","f","g","h","i"]}`, wantErr: true},
		{name: "reject non-object", input: `[]`, wantErr: true},
		{name: "reject trailing JSON", input: validKey + `{}`, wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			key, err := ParseUserEncryptionPublicKey([]byte(test.input))
			if (err != nil) != test.wantErr {
				t.Fatalf("ParseUserEncryptionPublicKey() error = %v; wantErr %t", err, test.wantErr)
			}
			if err != nil {
				return
			}
			if err := ValidateUserEncryptionPublicKey(key); err != nil {
				t.Fatalf("ValidateUserEncryptionPublicKey() error = %v", err)
			}
			encoded, err := json.Marshal(key)
			if err != nil {
				t.Fatalf("marshal public key: %v", err)
			}
			if strings.Contains(string(encoded), `"d"`) {
				t.Fatalf("public key serialization contains a private field: %s", encoded)
			}
		})
	}
}
