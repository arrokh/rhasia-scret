package http

import (
	"errors"
	"net/http"
	"time"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	membershipapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-membership/application"
	membershipdomain "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-membership/domain"
)

type VaultParticipantHandlers struct {
	authorizer   httpapi.ApplicationRequestAuthorizer
	participants membershipapp.VaultParticipantRepository
}

func NewVaultParticipantHandlers(
	authorizer httpapi.ApplicationRequestAuthorizer,
	participants membershipapp.VaultParticipantRepository,
) *VaultParticipantHandlers {
	return &VaultParticipantHandlers{authorizer: authorizer, participants: participants}
}

func (handlers *VaultParticipantHandlers) OperationHandlers() map[string]httpapi.OperationHandler {
	return map[string]httpapi.OperationHandler{
		"getSharedvaultsVaultIdParticipants":              handlers.list,
		"deleteSharedvaultsVaultIdSharelinksInvitationId": handlers.cancelInvitation,
	}
}

type vaultParticipantOwnerResponse struct {
	ID    string `json:"id"`
	Email string `json:"email"`
}

type vaultParticipantResponse struct {
	Key                         string                                                   `json:"key"`
	Email                       string                                                   `json:"email"`
	Kind                        membershipapp.VaultParticipantKind                       `json:"kind"`
	UserID                      *string                                                  `json:"userId"`
	InvitationID                *string                                                  `json:"invitationId"`
	InvitationState             *membershipapp.VaultParticipantInvitationState           `json:"invitationState"`
	InvitedAt                   string                                                   `json:"invitedAt"`
	ExpiresAt                   *string                                                  `json:"expiresAt"`
	PermissionOverrides         *membershipdomain.SharedVaultAccountPermissionOverrides  `json:"permissionOverrides"`
	EffectiveAccountPermissions *membershipdomain.EffectiveSharedVaultAccountPermissions `json:"effectiveAccountPermissions"`
	PermissionsRevision         *int64                                                   `json:"permissionsRevision"`
}

type vaultParticipantsResponse struct {
	Owner                                  vaultParticipantOwnerResponse                  `json:"owner"`
	VaultDefaultAccountPermissions         membershipdomain.SharedVaultAccountPermissions `json:"vaultDefaultAccountPermissions"`
	VaultDefaultAccountPermissionsRevision int64                                          `json:"vaultDefaultAccountPermissionsRevision"`
	Participants                           []vaultParticipantResponse                     `json:"participants"`
	NextCursor                             *string                                        `json:"nextCursor"`
}

func (handlers *VaultParticipantHandlers) list(ctx *echo.Context) error {
	ownerID, authorized, err := handlers.authorize(ctx, "")
	if err != nil || !authorized {
		return err
	}
	if handlers.participants == nil {
		return errors.New("Vault participant repository is not configured")
	}
	vaultID := ctx.Param("vaultId")
	scope := "vault-participants:" + vaultID
	pageRequest, errorCode := httpapi.ParseTimestampCursorPageRequest(ctx.Request().URL.Query(), scope, func(key string) bool {
		_, valid := membershipapp.ParseVaultParticipantCursorKey(key)
		return valid
	})
	if errorCode != "" {
		return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: errorCode})
	}
	page, err := handlers.participants.ListForOwner(ctx.Request().Context(), ownerID, vaultID, pageRequest)
	if err != nil {
		return err
	}
	if page == nil {
		return ctx.JSON(http.StatusNotFound, httpapi.ApiError{Error: "owner_access_required"})
	}
	participants := make([]vaultParticipantResponse, len(page.Items))
	for index, participant := range page.Items {
		participants[index] = vaultParticipantResponse{
			Key: participant.Key, Email: participant.Email, Kind: participant.Kind,
			UserID: participant.UserID, InvitationID: participant.InvitationID, InvitationState: participant.InvitationState,
			InvitedAt: formatTimestamp(participant.InvitedAt), ExpiresAt: formatOptionalTimestamp(participant.ExpiresAt),
			PermissionOverrides: participant.PermissionOverrides, EffectiveAccountPermissions: participant.EffectiveAccountPermissions,
			PermissionsRevision: participant.PermissionsRevision,
		}
	}
	var nextCursor *string
	if page.NextCursor != nil {
		encoded, err := httpapi.EncodeTimestampCursor(*page.NextCursor, scope)
		if err != nil {
			return err
		}
		nextCursor = &encoded
	}
	return ctx.JSON(http.StatusOK, vaultParticipantsResponse{
		Owner:                                  vaultParticipantOwnerResponse{ID: page.Owner.ID, Email: page.Owner.Email},
		VaultDefaultAccountPermissions:         page.VaultDefaultAccountPermissions,
		VaultDefaultAccountPermissionsRevision: page.VaultDefaultAccountPermissionsRevision,
		Participants:                           participants,
		NextCursor:                             nextCursor,
	})
}

func (handlers *VaultParticipantHandlers) cancelInvitation(ctx *echo.Context) error {
	ownerID, authorized, err := handlers.authorize(ctx, "membership_mutation")
	if err != nil || !authorized {
		return err
	}
	if handlers.participants == nil {
		return errors.New("Vault participant repository is not configured")
	}
	cancelled, err := handlers.participants.CancelInvitation(
		ctx.Request().Context(), ownerID, ctx.Param("vaultId"), ctx.Param("invitationId"),
	)
	if err != nil {
		return err
	}
	if !cancelled {
		return ctx.JSON(http.StatusNotFound, httpapi.ApiError{Error: "invitation_unavailable"})
	}
	return ctx.NoContent(http.StatusNoContent)
}

func (handlers *VaultParticipantHandlers) authorize(ctx *echo.Context, mutation string) (string, bool, error) {
	if handlers.authorizer == nil {
		return "", false, errors.New("application request authorizer is not configured")
	}
	userID, authorized, err := handlers.authorizer.AuthorizeApplicationRequest(ctx, mutation)
	if err != nil || !authorized {
		return "", authorized, err
	}
	if userID == "" {
		return "", false, errors.New("application request authorizer returned an empty user ID")
	}
	return userID, true, nil
}

func formatTimestamp(value time.Time) string {
	return value.UTC().Format("2006-01-02T15:04:05.000Z")
}

func formatOptionalTimestamp(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := formatTimestamp(*value)
	return &formatted
}
