package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

type AccountDeletionPreviewQueryer interface {
	Queryer
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

type AccountDeletionPreview struct {
	PersonalVaultID   *string
	OwnedSharedVaults []OwnedSharedVaultDeletionPreview
}

type OwnedSharedVaultDeletionPreview struct {
	ID               string
	Lifecycle        string
	ViewerCandidates []SharedVaultTransferCandidate
}

type SharedVaultTransferCandidate struct {
	ID    string
	Email string
}

// GetAccountDeletionPreview returns the vault-management view used by the
// account-deletion flow without exposing vault tables to another module.
func GetAccountDeletionPreview(ctx context.Context, queryer AccountDeletionPreviewQueryer, ownerID string) (AccountDeletionPreview, error) {
	if queryer == nil || ownerID == "" {
		return AccountDeletionPreview{}, errors.New("account deletion vault preview is unavailable")
	}
	preview := AccountDeletionPreview{OwnedSharedVaults: make([]OwnedSharedVaultDeletionPreview, 0)}
	var personalVaultID string
	err := queryer.QueryRow(ctx, `
		SELECT id
		FROM vaults
		WHERE owner_id = $1 AND type = 'PERSONAL'
		ORDER BY created_at ASC
		LIMIT 1`, ownerID).Scan(&personalVaultID)
	if err == nil {
		preview.PersonalVaultID = &personalVaultID
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return AccountDeletionPreview{}, fmt.Errorf("load Personal Vault for account-deletion preview: %w", err)
	}

	vaultRows, err := queryer.Query(ctx, `
		SELECT id, lifecycle
		FROM vaults
		WHERE owner_id = $1 AND type = 'SHARED'
		ORDER BY created_at ASC, id ASC`, ownerID)
	if err != nil {
		return AccountDeletionPreview{}, fmt.Errorf("load owned Shared Vaults for account-deletion preview: %w", err)
	}
	for vaultRows.Next() {
		var vault OwnedSharedVaultDeletionPreview
		if err := vaultRows.Scan(&vault.ID, &vault.Lifecycle); err != nil {
			vaultRows.Close()
			return AccountDeletionPreview{}, fmt.Errorf("scan owned Shared Vault for account-deletion preview: %w", err)
		}
		vault.ViewerCandidates = make([]SharedVaultTransferCandidate, 0)
		preview.OwnedSharedVaults = append(preview.OwnedSharedVaults, vault)
	}
	if err := vaultRows.Err(); err != nil {
		vaultRows.Close()
		return AccountDeletionPreview{}, fmt.Errorf("iterate owned Shared Vaults for account-deletion preview: %w", err)
	}
	vaultRows.Close()

	candidateRows, err := queryer.Query(ctx, `
		SELECT vault.id, member.user_id, user_account.email
		FROM vaults AS vault
		JOIN vault_members AS member ON member.vault_id = vault.id
		JOIN application_users AS user_account ON user_account.id = member.user_id
		WHERE vault.owner_id = $1
		  AND vault.type = 'SHARED'
		  AND vault.lifecycle = 'ACTIVE'
		  AND member.role = 'VIEWER'
		  AND member.status = 'ACTIVE'
		  AND user_account.status = 'ACTIVE'
		  AND member.encrypted_vault_key IS NOT NULL
		  AND octet_length(member.encrypted_vault_key) > 0
		  AND member.key_version IS NOT NULL
		  AND member.key_version <> 0
		ORDER BY vault.created_at ASC, vault.id ASC, member.created_at ASC, member.user_id ASC`, ownerID)
	if err != nil {
		return AccountDeletionPreview{}, fmt.Errorf("load Shared Vault transfer candidates for account-deletion preview: %w", err)
	}
	defer candidateRows.Close()
	vaultIndices := make(map[string]int, len(preview.OwnedSharedVaults))
	for index, vault := range preview.OwnedSharedVaults {
		vaultIndices[vault.ID] = index
	}
	for candidateRows.Next() {
		var vaultID string
		var candidate SharedVaultTransferCandidate
		if err := candidateRows.Scan(&vaultID, &candidate.ID, &candidate.Email); err != nil {
			return AccountDeletionPreview{}, fmt.Errorf("scan Shared Vault transfer candidate for account-deletion preview: %w", err)
		}
		index, exists := vaultIndices[vaultID]
		if !exists {
			return AccountDeletionPreview{}, errors.New("Shared Vault transfer candidate is not in the owned-vault preview")
		}
		preview.OwnedSharedVaults[index].ViewerCandidates = append(preview.OwnedSharedVaults[index].ViewerCandidates, candidate)
	}
	if err := candidateRows.Err(); err != nil {
		return AccountDeletionPreview{}, fmt.Errorf("iterate Shared Vault transfer candidates for account-deletion preview: %w", err)
	}
	return preview, nil
}
