package service

import (
	"context"

	apiEntity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity"
)

type WorkspaceBundleReader interface {
	ReadOnlineWorkspaceBundle(context.Context, string) (*apiEntity.EncryptedOnlineWorkspaceBundle, error)
	ReadAuthorizedWorkspaceResponse(context.Context, string) (*apiEntity.AuthorizedWorkspaceResponse, error)
}
