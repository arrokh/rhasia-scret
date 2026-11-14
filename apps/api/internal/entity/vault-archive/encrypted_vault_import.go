package domain

import (
	"errors"

	identity "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity"
)

const (
	MaxVaultArchiveImportAccounts           = 500
	MaxVaultArchiveImportRequestBytes int64 = 8 * 1024 * 1024
	MaxImportedCiphertextBytes              = 16*1024 + 29
)

type DestinationKind string

const (
	DestinationExisting  DestinationKind = "EXISTING"
	DestinationNewShared DestinationKind = "NEW_SHARED"
)

type ExistingVaultDestination struct {
	VaultID            string
	VaultType          string
	ExpectedKeyVersion *int64
}

type NewSharedVaultDestination struct {
	VaultID                string
	EncryptedName          []byte
	EncryptedOwnerVaultKey []byte
	ExpectedOwnerPublicKey identity.PublicEncryptionKey
	EncryptionVersion      int
}

type Destination struct {
	Kind      DestinationKind
	Existing  ExistingVaultDestination
	NewShared NewSharedVaultDestination
}

func (destination Destination) VaultID() string {
	if destination.Kind == DestinationExisting {
		return destination.Existing.VaultID
	}
	return destination.NewShared.VaultID
}

func (destination Destination) VaultType() string {
	if destination.Kind == DestinationExisting {
		return destination.Existing.VaultType
	}
	return "SHARED"
}

type EncryptedImportedAccount struct {
	ID                string
	EncryptedPayload  []byte
	EncryptionVersion int
}

type EncryptedVaultImport struct {
	Destination Destination
	Accounts    []EncryptedImportedAccount
}

type ImportStatus string

const (
	ImportStatusImported               ImportStatus = "IMPORTED"
	ImportStatusReplayed               ImportStatus = "REPLAYED"
	ImportStatusDestinationUnavailable ImportStatus = "DESTINATION_UNAVAILABLE"
	ImportStatusConflict               ImportStatus = "CONFLICT"
)

type EncryptedVaultImportResult struct {
	Status       ImportStatus
	VaultID      string
	AccountIDs   []string
	VaultCreated bool
}

func HasDuplicateImportedAccountIDs(accounts []EncryptedImportedAccount) bool {
	seen := make(map[string]struct{}, len(accounts))
	for _, account := range accounts {
		if _, exists := seen[account.ID]; exists {
			return true
		}
		seen[account.ID] = struct{}{}
	}
	return false
}

func ValidateEncryptedVaultImport(request EncryptedVaultImport) error {
	if len(request.Accounts) > MaxVaultArchiveImportAccounts || HasDuplicateImportedAccountIDs(request.Accounts) {
		return errors.New("encrypted Vault archive import is invalid")
	}
	for _, account := range request.Accounts {
		if account.ID == "" || len(account.EncryptedPayload) < 29 || len(account.EncryptedPayload) > MaxImportedCiphertextBytes ||
			(account.EncryptedPayload[0] != 1 && account.EncryptedPayload[0] != 2) || account.EncryptionVersion != 1 {
			return errors.New("encrypted Vault archive import is invalid")
		}
	}
	switch request.Destination.Kind {
	case DestinationExisting:
		if request.Destination.Existing.VaultID == "" ||
			(request.Destination.Existing.VaultType != "PERSONAL" && request.Destination.Existing.VaultType != "SHARED") {
			return errors.New("encrypted Vault archive destination is invalid")
		}
		if request.Destination.Existing.VaultType == "SHARED" &&
			(request.Destination.Existing.ExpectedKeyVersion == nil || *request.Destination.Existing.ExpectedKeyVersion < 1) {
			return errors.New("encrypted Shared Vault archive destination is invalid")
		}
	case DestinationNewShared:
		if request.Destination.NewShared.VaultID == "" || len(request.Destination.NewShared.EncryptedName) < 29 ||
			len(request.Destination.NewShared.EncryptedName) > 1024 || len(request.Destination.NewShared.EncryptedOwnerVaultKey) < 29 ||
			len(request.Destination.NewShared.EncryptedOwnerVaultKey) > 1024 || request.Destination.NewShared.EncryptionVersion != 1 ||
			(request.Destination.NewShared.EncryptedName[0] != 1 && request.Destination.NewShared.EncryptedName[0] != 2) ||
			(request.Destination.NewShared.EncryptedOwnerVaultKey[0] != 1 && request.Destination.NewShared.EncryptedOwnerVaultKey[0] != 2) ||
			identity.ValidatePublicEncryptionKey(request.Destination.NewShared.ExpectedOwnerPublicKey) != nil {
			return errors.New("encrypted new Shared Vault archive destination is invalid")
		}
	default:
		return errors.New("encrypted Vault archive destination is invalid")
	}
	return nil
}
