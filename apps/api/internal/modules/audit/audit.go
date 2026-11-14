package audit

import (
	"context"
	"time"

	auditentity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity/audit"
	auditrepository "github.com/nooroctavian/rhasia-scret/apps/api/internal/repository/audit"
)

type Action = auditentity.Action
type RedactedAction = auditentity.RedactedAction
type VaultAuditAppend = auditentity.VaultAuditAppend

type PostgreSQLBeginner = auditrepository.PostgreSQLBeginner
type VaultAuditTransaction = auditrepository.VaultAuditTransaction
type auditRetentionQueryer = auditrepository.AuditRetentionQueryer

const (
	UnknownSecurityActivity                    = auditentity.UnknownSecurityActivity
	ActionVaultCreated                         = auditentity.ActionVaultCreated
	ActionAccountAdded                         = auditentity.ActionAccountAdded
	ActionAccountUpdated                       = auditentity.ActionAccountUpdated
	ActionAccountDeleted                       = auditentity.ActionAccountDeleted
	ActionAccountRestored                      = auditentity.ActionAccountRestored
	ActionMemberRevoked                        = auditentity.ActionMemberRevoked
	ActionMemberPermissionsUpdated             = auditentity.ActionMemberPermissionsUpdated
	ActionVaultMemberDefaultPermissionsUpdated = auditentity.ActionVaultMemberDefaultPermissionsUpdated
	ActionAccountAccessed                      = auditentity.ActionAccountAccessed
	ActionAccountCopiedFromLocal               = auditentity.ActionAccountCopiedFromLocal
	ActionAccountCopiedToLocal                 = auditentity.ActionAccountCopiedToLocal
	ActionArchiveExported                      = auditentity.ActionArchiveExported
	ActionArchiveImported                      = auditentity.ActionArchiveImported
	ActionVaultDeleted                         = auditentity.ActionVaultDeleted
	ActionVaultRestored                        = auditentity.ActionVaultRestored
	ActionVaultKeyRotated                      = auditentity.ActionVaultKeyRotated
	ActionUserEncryptionKeyPairRotated         = auditentity.ActionUserEncryptionKeyPairRotated
)

func AppendVaultAuditEvent(ctx context.Context, transaction VaultAuditTransaction, event VaultAuditAppend) error {
	return auditrepository.AppendVaultAuditEvent(ctx, transaction, event)
}

func RedactAction(value string) RedactedAction {
	return auditentity.RedactAction(value)
}

func AuditPurgeAfter(vaultDeletedAt time.Time) time.Time {
	return auditentity.AuditPurgeAfter(vaultDeletedAt)
}

func RecordArchiveExport(ctx context.Context, database PostgreSQLBeginner, ownerID string, vaultID string) (bool, error) {
	return auditrepository.RecordArchiveExport(ctx, database, ownerID, vaultID)
}

func SetVaultAuditRetention(ctx context.Context, transaction VaultAuditTransaction, vaultID, ownerID string, retainUntil time.Time) error {
	return auditrepository.SetVaultAuditRetention(ctx, transaction, vaultID, ownerID, retainUntil)
}

func PurgeExpiredVaultAuditEvents(ctx context.Context, database auditRetentionQueryer, now time.Time, batchSize int) ([]string, error) {
	return auditrepository.PurgeExpiredVaultAuditEvents(ctx, database, now, batchSize)
}
