package application

import (
	"context"

	syncdomain "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity/sync"
)

type WorkspaceBundleReader interface {
	ReadOnlineWorkspaceBundle(context.Context, string) (*syncdomain.EncryptedOnlineWorkspaceBundle, error)
	ReadAuthorizedWorkspaceResponse(context.Context, string) (*syncdomain.AuthorizedWorkspaceResponse, error)
}
