package audit

import "time"

type Action string
type RedactedAction string

const (
	UnknownSecurityActivity                    RedactedAction = "UNKNOWN_SECURITY_ACTIVITY"
	ActionVaultCreated                         Action         = "VAULT_CREATED"
	ActionAccountAdded                         Action         = "ACCOUNT_ADDED"
	ActionAccountUpdated                       Action         = "ACCOUNT_UPDATED"
	ActionAccountDeleted                       Action         = "ACCOUNT_DELETED"
	ActionAccountRestored                      Action         = "ACCOUNT_RESTORED"
	ActionMemberRevoked                        Action         = "MEMBER_REVOKED"
	ActionMemberPermissionsUpdated             Action         = "MEMBER_PERMISSIONS_UPDATED"
	ActionVaultMemberDefaultPermissionsUpdated Action         = "VAULT_MEMBER_DEFAULT_PERMISSIONS_UPDATED"
	ActionAccountAccessed                      Action         = "ACCOUNT_ACCESSED"
	ActionAccountCopiedFromLocal               Action         = "ACCOUNT_COPIED_FROM_LOCAL"
	ActionAccountCopiedToLocal                 Action         = "ACCOUNT_COPIED_TO_LOCAL"
	ActionArchiveExported                      Action         = "ARCHIVE_EXPORTED"
	ActionArchiveImported                      Action         = "ARCHIVE_IMPORTED"
	ActionVaultDeleted                         Action         = "VAULT_DELETED"
	ActionVaultRestored                        Action         = "VAULT_RESTORED"
	ActionVaultKeyRotated                      Action         = "VAULT_KEY_ROTATED"
	ActionUserEncryptionKeyPairRotated         Action         = "USER_ENCRYPTION_KEY_PAIR_ROTATED"
)

type VaultAuditAppend struct {
	VaultID             string
	OwnerID             string
	ActorUserID         string
	Action              Action
	TargetID            string
	RetentionPurgeAfter *time.Time
}

func RedactAction(value string) RedactedAction {
	action := Action(value)
	if IsValidAction(action) {
		return RedactedAction(action)
	}
	return UnknownSecurityActivity
}

func AuditPurgeAfter(vaultDeletedAt time.Time) time.Time {
	return vaultDeletedAt.UTC().AddDate(1, 0, 0)
}

func IsValidAction(action Action) bool {
	switch action {
	case ActionVaultCreated,
		ActionAccountAdded,
		ActionAccountUpdated,
		ActionAccountDeleted,
		ActionAccountRestored,
		ActionMemberRevoked,
		ActionMemberPermissionsUpdated,
		ActionVaultMemberDefaultPermissionsUpdated,
		ActionAccountAccessed,
		ActionAccountCopiedFromLocal,
		ActionAccountCopiedToLocal,
		ActionArchiveExported,
		ActionArchiveImported,
		ActionVaultDeleted,
		ActionVaultRestored,
		ActionVaultKeyRotated,
		ActionUserEncryptionKeyPairRotated:
		return true
	default:
		return false
	}
}
