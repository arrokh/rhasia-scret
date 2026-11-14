package service

import (
	"context"
	"time"

	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

const MaxAccountCopyAuditIDs = 500

type VaultAuditFilter struct {
	AccountID   *string
	ActorUserID *string
}

type RedactedVaultAuditEvent struct {
	ID          string
	EventType   string
	TargetID    *string
	ActorUserID string
	ActorEmail  string
	CreatedAt   time.Time
}

type VaultAuditRepository interface {
	RecordAccountAccess(context.Context, string, string, string) (bool, error)
	RecordPersonalAccountCopiesToLocal(context.Context, string, string, []string) (bool, error)
	RecordArchiveExport(context.Context, string, string) (bool, error)
	ListForOwner(context.Context, string, string, VaultAuditFilter, sharedapp.CursorPageRequest) (*sharedapp.CursorPage[RedactedVaultAuditEvent], error)
}
