package entity

import (
	"errors"
)

type VaultType string

type VaultLifecycle string

const (
	VaultTypePersonal VaultType = "PERSONAL"
	VaultTypeShared   VaultType = "SHARED"

	VaultLifecycleUninitialized VaultLifecycle = "UNINITIALIZED"
	VaultLifecycleActive        VaultLifecycle = "ACTIVE"
)

type Vault struct {
	ID        string
	Type      VaultType
	OwnerID   string
	Lifecycle VaultLifecycle
}

func NewVault(id string, vaultType VaultType, ownerID string, lifecycle VaultLifecycle) (Vault, error) {
	if id == "" || ownerID == "" {
		return Vault{}, errors.New("vault identity and owner are required")
	}
	if vaultType != VaultTypePersonal && vaultType != VaultTypeShared {
		return Vault{}, errors.New("vault type is invalid")
	}
	if lifecycle != VaultLifecycleUninitialized && lifecycle != VaultLifecycleActive {
		return Vault{}, errors.New("vault lifecycle is invalid")
	}
	if vaultType == VaultTypeShared && lifecycle == VaultLifecycleUninitialized {
		return Vault{}, errors.New("only a Personal Vault may be uninitialized")
	}
	return Vault{ID: id, Type: vaultType, OwnerID: ownerID, Lifecycle: lifecycle}, nil
}

func (vault Vault) CanBeDeletedByOwner() bool {
	return vault.Type == VaultTypeShared
}

func (vault Vault) CanHoldAccounts() bool {
	return vault.Lifecycle == VaultLifecycleActive
}
