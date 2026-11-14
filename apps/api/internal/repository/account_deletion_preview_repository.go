package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
)

type PreviewRepository struct {
	pool *pgxpool.Pool
}

func NewPreviewRepository(pool *pgxpool.Pool) (*PreviewRepository, error) {
	if pool == nil {
		return nil, errors.New("account deletion preview repository is not configured")
	}
	return &PreviewRepository{pool: pool}, nil
}

func (repository *PreviewRepository) GetPreview(ctx context.Context, applicationUserID string) (apiService.Preview, error) {
	vaultPreview, err := GetAccountDeletionPreview(ctx, repository.pool, applicationUserID)
	if err != nil {
		return apiService.Preview{}, fmt.Errorf("load account deletion preview: %w", err)
	}
	preview := apiService.Preview{
		PersonalVaultID:   vaultPreview.PersonalVaultID,
		OwnedSharedVaults: make([]apiService.OwnedSharedVaultPreview, 0, len(vaultPreview.OwnedSharedVaults)),
	}
	for _, vault := range vaultPreview.OwnedSharedVaults {
		ownedVault := apiService.OwnedSharedVaultPreview{
			ID:               vault.ID,
			Lifecycle:        vault.Lifecycle,
			ViewerCandidates: make([]apiService.DeletionViewerCandidate, 0, len(vault.ViewerCandidates)),
		}
		for _, candidate := range vault.ViewerCandidates {
			ownedVault.ViewerCandidates = append(ownedVault.ViewerCandidates, apiService.DeletionViewerCandidate{
				ID: candidate.ID, Email: candidate.Email,
			})
		}
		preview.OwnedSharedVaults = append(preview.OwnedSharedVaults, ownedVault)
	}
	return preview, nil
}

var _ apiService.PreviewRepository = (*PreviewRepository)(nil)
