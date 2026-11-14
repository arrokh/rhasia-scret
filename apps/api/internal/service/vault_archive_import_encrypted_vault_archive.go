package service

import (
	"context"
	"errors"

	apiEntity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity"
)

type EncryptedVaultImportRepository interface {
	Import(context.Context, string, apiEntity.EncryptedVaultImport) (apiEntity.EncryptedVaultImportResult, error)
}

func ImportEncryptedVaultArchive(
	ctx context.Context,
	actorUserID string,
	request apiEntity.EncryptedVaultImport,
	repository EncryptedVaultImportRepository,
) (apiEntity.EncryptedVaultImportResult, error) {
	if actorUserID == "" || repository == nil || apiEntity.ValidateEncryptedVaultImport(request) != nil {
		return apiEntity.EncryptedVaultImportResult{}, errors.New("encrypted Vault archive import is invalid")
	}
	return repository.Import(ctx, actorUserID, request)
}
