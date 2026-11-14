package service

import (
	"context"
)

type DeletionViewerCandidate struct {
	ID    string `json:"id"`
	Email string `json:"email"`
}

type OwnedSharedVaultPreview struct {
	ID               string                    `json:"id"`
	Lifecycle        string                    `json:"lifecycle"`
	ViewerCandidates []DeletionViewerCandidate `json:"viewerCandidates"`
}

type Preview struct {
	PersonalVaultID   *string                   `json:"personalVaultId"`
	OwnedSharedVaults []OwnedSharedVaultPreview `json:"ownedSharedVaults"`
}

type PreviewRepository interface {
	GetPreview(context.Context, string) (Preview, error)
}
