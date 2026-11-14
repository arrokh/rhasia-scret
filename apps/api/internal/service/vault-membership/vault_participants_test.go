package application

import "testing"

func TestParseVaultParticipantCursorKey(t *testing.T) {
	tests := []struct {
		name  string
		key   string
		kind  string
		id    string
		valid bool
	}{
		{name: "member", key: "member:synthetic-user", kind: string(VaultParticipantKindMember), id: "synthetic-user", valid: true},
		{name: "invitation", key: "invitation:synthetic-id:part", kind: string(VaultParticipantKindInvitation), id: "synthetic-id:part", valid: true},
		{name: "unknown kind", key: "unknown:synthetic-id"},
		{name: "missing ID", key: "member:"},
		{name: "empty", key: ""},
		{name: "line break in ID", key: "member:synthetic\nuser"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, valid := ParseVaultParticipantCursorKey(test.key)
			if valid != test.valid || got.Kind != test.kind || got.ID != test.id {
				t.Fatalf("ParseVaultParticipantCursorKey(%q)=(%#v,%t); want (%q,%q,%t)", test.key, got, valid, test.kind, test.id, test.valid)
			}
		})
	}
}
