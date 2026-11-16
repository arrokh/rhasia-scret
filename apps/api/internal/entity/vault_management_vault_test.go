package entity

import (
	"testing"
)

func TestNewVaultEnforcesIdentityTypeAndLifecycleRules(t *testing.T) {
	if _, err := NewVault("", VaultTypePersonal, "owner", VaultLifecycleActive); err == nil {
		t.Fatal("accepted a Vault without an ID")
	}
	if _, err := NewVault("vault", VaultTypePersonal, "", VaultLifecycleActive); err == nil {
		t.Fatal("accepted a Vault without an owner")
	}
	if _, err := NewVault("vault", VaultType("OTHER"), "owner", VaultLifecycleActive); err == nil {
		t.Fatal("accepted an unsupported Vault type")
	}
	if _, err := NewVault("vault", VaultTypePersonal, "owner", VaultLifecycle("DELETED")); err == nil {
		t.Fatal("accepted an unsupported Vault lifecycle")
	}
	if _, err := NewVault("vault", VaultTypeShared, "owner", VaultLifecycleUninitialized); err == nil {
		t.Fatal("accepted an uninitialized Shared Vault")
	}
}

func TestVaultCapabilitiesFollowTypeAndLifecycle(t *testing.T) {
	personal, err := NewVault("personal", VaultTypePersonal, "owner", VaultLifecycleUninitialized)
	if err != nil {
		t.Fatal(err)
	}
	if personal.CanBeDeletedByOwner() || personal.CanHoldAccounts() {
		t.Fatal("uninitialized Personal Vault has incorrect capabilities")
	}
	shared, err := NewVault("shared", VaultTypeShared, "owner", VaultLifecycleActive)
	if err != nil {
		t.Fatal(err)
	}
	if !shared.CanBeDeletedByOwner() || !shared.CanHoldAccounts() {
		t.Fatal("active Shared Vault has incorrect capabilities")
	}
}
