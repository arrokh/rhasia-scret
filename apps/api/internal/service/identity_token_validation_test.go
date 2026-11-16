package service

import (
	"testing"
)

func TestIsSafeToken(t *testing.T) {
	tests := []struct {
		name    string
		value   string
		minimum int
		maximum int
		valid   bool
	}{
		{name: "alphanumeric and URL-safe separators", value: "abc_DEF-123", minimum: 1, maximum: 128, valid: true},
		{name: "below minimum", value: "short", minimum: 6, maximum: 128},
		{name: "above maximum", value: "longer", minimum: 1, maximum: 5},
		{name: "reject punctuation", value: "bad.token", minimum: 1, maximum: 128},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if valid := IsSafeToken(test.value, test.minimum, test.maximum); valid != test.valid {
				t.Fatalf("IsSafeToken(%q)=%t; want %t", test.value, valid, test.valid)
			}
		})
	}
}
