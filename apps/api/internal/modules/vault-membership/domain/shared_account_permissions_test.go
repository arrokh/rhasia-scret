package domain

import "testing"

func TestEffectiveSharedVaultAccountPermissionsForOwner(t *testing.T) {
	falseValue := false
	got := EffectiveSharedVaultAccountPermissionsFor(
		SharedVaultMemberRoleOwner,
		SharedVaultAccountPermissions{},
		SharedVaultAccountPermissionOverrides{
			CanAddAccounts:    &falseValue,
			CanEditAccounts:   &falseValue,
			CanDeleteAccounts: &falseValue,
		},
	)
	want := EffectiveSharedVaultAccountPermissions{
		Permissions: SharedVaultAccountPermissions{CanAddAccounts: true, CanEditAccounts: true, CanDeleteAccounts: true},
		Sources: SharedVaultAccountPermissionSources{
			CanAddAccounts:    SharedVaultAccountPermissionSourceOwner,
			CanEditAccounts:   SharedVaultAccountPermissionSourceOwner,
			CanDeleteAccounts: SharedVaultAccountPermissionSourceOwner,
		},
	}
	if got != want {
		t.Fatalf("owner permissions=%#v; want %#v", got, want)
	}
}

func TestEffectiveSharedVaultAccountPermissionsForViewer(t *testing.T) {
	falseValue := false
	trueValue := true
	got := EffectiveSharedVaultAccountPermissionsFor(
		SharedVaultMemberRoleViewer,
		SharedVaultAccountPermissions{CanAddAccounts: true, CanEditAccounts: false, CanDeleteAccounts: true},
		SharedVaultAccountPermissionOverrides{
			CanAddAccounts:    &falseValue,
			CanEditAccounts:   &trueValue,
			CanDeleteAccounts: nil,
		},
	)
	want := EffectiveSharedVaultAccountPermissions{
		Permissions: SharedVaultAccountPermissions{CanAddAccounts: false, CanEditAccounts: true, CanDeleteAccounts: true},
		Sources: SharedVaultAccountPermissionSources{
			CanAddAccounts:    SharedVaultAccountPermissionSourceMember,
			CanEditAccounts:   SharedVaultAccountPermissionSourceMember,
			CanDeleteAccounts: SharedVaultAccountPermissionSourceVault,
		},
	}
	if got != want {
		t.Fatalf("viewer permissions=%#v; want %#v", got, want)
	}
}

func TestCanPerformSharedVaultAccountOperation(t *testing.T) {
	permissions := SharedVaultAccountPermissions{CanEditAccounts: true}
	tests := []struct {
		name      string
		operation SharedVaultAccountOperation
		want      bool
	}{
		{name: "add denied", operation: SharedVaultAccountOperationAdd, want: false},
		{name: "edit allowed", operation: SharedVaultAccountOperationEdit, want: true},
		{name: "delete denied", operation: SharedVaultAccountOperationDelete, want: false},
		{name: "unknown denied", operation: "UNKNOWN", want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := CanPerformSharedVaultAccountOperation(permissions, test.operation); got != test.want {
				t.Fatalf("CanPerformSharedVaultAccountOperation(%#v, %q)=%t; want %t", permissions, test.operation, got, test.want)
			}
		})
	}
}

func TestParseSharedVaultMemberRole(t *testing.T) {
	tests := []struct {
		value string
		want  SharedVaultMemberRole
		valid bool
	}{
		{value: "OWNER", want: SharedVaultMemberRoleOwner, valid: true},
		{value: "VIEWER", want: SharedVaultMemberRoleViewer, valid: true},
		{value: "UNKNOWN", valid: false},
		{value: "", valid: false},
	}
	for _, test := range tests {
		t.Run(test.value, func(t *testing.T) {
			got, valid := ParseSharedVaultMemberRole(test.value)
			if got != test.want || valid != test.valid {
				t.Fatalf("ParseSharedVaultMemberRole(%q)=(%q,%t); want (%q,%t)", test.value, got, valid, test.want, test.valid)
			}
		})
	}
}
