package domain

import (
	"encoding/json"
	"errors"
	"regexp"

	membershipdomain "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity/vault-membership"
	identity "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/identity"
)

var opaqueIdentifier = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

type EncryptedOfflineAccount struct {
	ID                string `json:"id"`
	EncryptedPayload  string `json:"encryptedPayload"`
	EncryptionVersion int    `json:"encryptionVersion"`
	Revision          int64  `json:"revision"`
}

type EncryptedOfflinePersonalVault struct {
	VaultID           string                    `json:"vaultId"`
	Lifecycle         string                    `json:"lifecycle"`
	EncryptedName     string                    `json:"encryptedName"`
	EncryptionVersion int                       `json:"encryptionVersion"`
	Accounts          []EncryptedOfflineAccount `json:"accounts"`
}

type EncryptedOnlineSharedVault struct {
	VaultID                     string                                                  `json:"vaultId"`
	Lifecycle                   string                                                  `json:"lifecycle"`
	Role                        string                                                  `json:"role"`
	EffectiveAccountPermissions membershipdomain.EffectiveSharedVaultAccountPermissions `json:"effectiveAccountPermissions"`
	EncryptedName               string                                                  `json:"encryptedName"`
	EncryptionVersion           int                                                     `json:"encryptionVersion"`
	EncryptedVaultKey           string                                                  `json:"encryptedVaultKey"`
	KeyVersion                  int64                                                   `json:"keyVersion"`
	Accounts                    []EncryptedOfflineAccount                               `json:"accounts"`
}

type EncryptedOfflineCryptoProfile struct {
	VaultUnlockSalt           string `json:"vaultUnlockSalt"`
	WrappedUserRootKey        string `json:"wrappedUserRootKey"`
	EncryptedPersonalVaultKey string `json:"encryptedPersonalVaultKey"`
	EncryptionVersion         int    `json:"encryptionVersion"`
}

type EncryptedOnlineWorkspaceBundle struct {
	SchemaVersion        int                           `json:"schemaVersion"`
	ProfileID            string                        `json:"profileId"`
	SynchronizedAt       string                        `json:"synchronizedAt"`
	SynchronizationToken string                        `json:"synchronizationToken"`
	CryptoProfile        EncryptedOfflineCryptoProfile `json:"cryptoProfile"`
	PersonalVault        EncryptedOfflinePersonalVault `json:"personalVault"`
	SharedVaults         []EncryptedOnlineSharedVault  `json:"sharedVaults"`
}

type EncryptedPersonalOfflineSnapshot struct {
	SchemaVersion        int                           `json:"schemaVersion"`
	ProfileID            string                        `json:"profileId"`
	SynchronizedAt       string                        `json:"synchronizedAt"`
	SynchronizationToken string                        `json:"synchronizationToken"`
	CryptoProfile        EncryptedOfflineCryptoProfile `json:"cryptoProfile"`
	PersonalVault        EncryptedOfflinePersonalVault `json:"personalVault"`
}

type EncryptedUserEncryptionIdentity struct {
	PublicKey           json.RawMessage `json:"publicKey"`
	EncryptedPrivateKey string          `json:"encryptedPrivateKey"`
	EncryptionVersion   int             `json:"encryptionVersion"`
}

type AuthorizedWorkspaceResponse struct {
	ResponseVersion               int                              `json:"responseVersion"`
	WorkspaceSynchronizationToken string                           `json:"workspaceSynchronizationToken"`
	SynchronizedAt                string                           `json:"synchronizedAt"`
	PersonalSnapshot              EncryptedPersonalOfflineSnapshot `json:"personalSnapshot"`
	SharedVaults                  []EncryptedOnlineSharedVault     `json:"sharedVaults"`
	UserEncryptionIdentity        *EncryptedUserEncryptionIdentity `json:"userEncryptionIdentity,omitempty"`
}

func ValidateOpaqueIdentifier(value string) error {
	if len(value) < 1 || len(value) > 256 || !opaqueIdentifier.MatchString(value) {
		return errors.New("offline bundle identifier is invalid")
	}
	return nil
}

func ValidatePublicEncryptionKey(raw json.RawMessage) (identity.UserEncryptionPublicKey, error) {
	key, err := identity.ParseUserEncryptionPublicKey(raw)
	if err != nil {
		return identity.UserEncryptionPublicKey{}, err
	}
	return key, nil
}
