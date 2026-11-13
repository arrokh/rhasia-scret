package application

import (
	"context"
	"errors"

	vaultarchivedomain "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-archive/domain"
)

type EncryptedVaultImportRepository interface {
	Import(context.Context, string, vaultarchivedomain.EncryptedVaultImport) (vaultarchivedomain.EncryptedVaultImportResult, error)
}

func ImportEncryptedVaultArchive(
	ctx context.Context,
	actorUserID string,
	request vaultarchivedomain.EncryptedVaultImport,
	repository EncryptedVaultImportRepository,
) (vaultarchivedomain.EncryptedVaultImportResult, error) {
	if actorUserID == "" || repository == nil || vaultarchivedomain.ValidateEncryptedVaultImport(request) != nil {
		return vaultarchivedomain.EncryptedVaultImportResult{}, errors.New("encrypted Vault archive import is invalid")
	}
	return repository.Import(ctx, actorUserID, request)
}
