package vaultmanagement

import (
	"context"

	vaultrepository "github.com/nooroctavian/rhasia-scret/apps/api/internal/repository/vault-management"
)

type AccountDeletionPreviewQueryer = vaultrepository.AccountDeletionPreviewQueryer
type AccountDeletionPreview = vaultrepository.AccountDeletionPreview
type OwnedSharedVaultDeletionPreview = vaultrepository.OwnedSharedVaultDeletionPreview
type SharedVaultTransferCandidate = vaultrepository.SharedVaultTransferCandidate

func GetAccountDeletionPreview(ctx context.Context, queryer AccountDeletionPreviewQueryer, ownerID string) (AccountDeletionPreview, error) {
	return vaultrepository.GetAccountDeletionPreview(ctx, queryer, ownerID)
}
