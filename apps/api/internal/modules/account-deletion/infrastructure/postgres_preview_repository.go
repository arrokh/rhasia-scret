package infrastructure

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	accountapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/account-deletion/application"
	vaultmanagement "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-management"
)

type PostgresPreviewRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresPreviewRepository(pool *pgxpool.Pool) (*PostgresPreviewRepository, error) {
	if pool == nil {
		return nil, errors.New("account deletion preview repository is not configured")
	}
	return &PostgresPreviewRepository{pool: pool}, nil
}

func (repository *PostgresPreviewRepository) GetPreview(ctx context.Context, applicationUserID string) (accountapp.Preview, error) {
	vaultPreview, err := vaultmanagement.GetAccountDeletionPreview(ctx, repository.pool, applicationUserID)
	if err != nil {
		return accountapp.Preview{}, fmt.Errorf("load account deletion preview: %w", err)
	}
	preview := accountapp.Preview{
		PersonalVaultID:   vaultPreview.PersonalVaultID,
		OwnedSharedVaults: make([]accountapp.OwnedSharedVaultPreview, 0, len(vaultPreview.OwnedSharedVaults)),
	}
	for _, vault := range vaultPreview.OwnedSharedVaults {
		ownedVault := accountapp.OwnedSharedVaultPreview{
			ID:               vault.ID,
			Lifecycle:        vault.Lifecycle,
			ViewerCandidates: make([]accountapp.DeletionViewerCandidate, 0, len(vault.ViewerCandidates)),
		}
		for _, candidate := range vault.ViewerCandidates {
			ownedVault.ViewerCandidates = append(ownedVault.ViewerCandidates, accountapp.DeletionViewerCandidate{
				ID: candidate.ID, Email: candidate.Email,
			})
		}
		preview.OwnedSharedVaults = append(preview.OwnedSharedVaults, ownedVault)
	}
	return preview, nil
}

var _ accountapp.PreviewRepository = (*PostgresPreviewRepository)(nil)
