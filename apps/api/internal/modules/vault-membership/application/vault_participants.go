package application

import (
	"context"
	"strings"
	"time"

	membershipdomain "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-membership/domain"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

type VaultParticipantKind string

type VaultParticipantInvitationState string

const (
	VaultParticipantKindMember     VaultParticipantKind = "MEMBER"
	VaultParticipantKindInvitation VaultParticipantKind = "INVITATION"

	VaultParticipantInvitationPending VaultParticipantInvitationState = "PENDING"
	VaultParticipantInvitationExpired VaultParticipantInvitationState = "EXPIRED"
)

type VaultParticipantCursorKey struct {
	Kind string
	ID   string
}

type VaultParticipant struct {
	Key                         string
	Email                       string
	Kind                        VaultParticipantKind
	UserID                      *string
	InvitationID                *string
	InvitationState             *VaultParticipantInvitationState
	InvitedAt                   time.Time
	ExpiresAt                   *time.Time
	PermissionOverrides         *membershipdomain.SharedVaultAccountPermissionOverrides
	EffectiveAccountPermissions *membershipdomain.EffectiveSharedVaultAccountPermissions
	PermissionsRevision         *int64
}

type VaultParticipantOwner struct {
	ID    string
	Email string
}

type VaultParticipantPage struct {
	Owner                                  VaultParticipantOwner
	VaultDefaultAccountPermissions         membershipdomain.SharedVaultAccountPermissions
	VaultDefaultAccountPermissionsRevision int64
	Items                                  []VaultParticipant
	NextCursor                             *sharedapp.TimestampCursor
}

type VaultParticipantRepository interface {
	ListForOwner(context.Context, string, string, sharedapp.CursorPageRequest) (*VaultParticipantPage, error)
	CancelInvitation(context.Context, string, string, string) (bool, error)
}

func ParseVaultParticipantCursorKey(key string) (VaultParticipantCursorKey, bool) {
	kind, id, found := strings.Cut(key, ":")
	if !found || id == "" || strings.ContainsAny(id, "\n\r\u2028\u2029") {
		return VaultParticipantCursorKey{}, false
	}
	switch kind {
	case "member":
		return VaultParticipantCursorKey{Kind: string(VaultParticipantKindMember), ID: id}, true
	case "invitation":
		return VaultParticipantCursorKey{Kind: string(VaultParticipantKindInvitation), ID: id}, true
	default:
		return VaultParticipantCursorKey{}, false
	}
}
