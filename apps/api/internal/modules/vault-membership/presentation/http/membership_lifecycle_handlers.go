package http

import (
	"errors"
	"net/http"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	membershipapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-membership/application"
)

type MembershipLifecycleHandlers struct {
	authorizer httpapi.ApplicationRequestAuthorizer
	lifecycle  membershipapp.MembershipLifecycleRepository
}

func NewMembershipLifecycleHandlers(
	authorizer httpapi.ApplicationRequestAuthorizer,
	lifecycle membershipapp.MembershipLifecycleRepository,
) *MembershipLifecycleHandlers {
	return &MembershipLifecycleHandlers{authorizer: authorizer, lifecycle: lifecycle}
}

func (handlers *MembershipLifecycleHandlers) OperationHandlers() map[string]httpapi.OperationHandler {
	return map[string]httpapi.OperationHandler{
		"deleteSharedvaultsVaultIdMembersUserId": handlers.revoke,
		"postSharedvaultsVaultIdLeave":           handlers.leave,
	}
}

func (handlers *MembershipLifecycleHandlers) revoke(ctx *echo.Context) error {
	ownerID, authorized, err := handlers.authorize(ctx)
	if err != nil || !authorized {
		return err
	}
	if handlers.lifecycle == nil {
		return errors.New("Shared Vault membership lifecycle repository is not configured")
	}
	if err := handlers.lifecycle.Revoke(ctx.Request().Context(), ownerID, ctx.Param("vaultId"), ctx.Param("userId")); err != nil {
		if errors.Is(err, membershipapp.ErrMembershipUnavailable) {
			return ctx.JSON(http.StatusNotFound, httpapi.ApiError{Error: "member_unavailable"})
		}
		return err
	}
	return ctx.NoContent(http.StatusNoContent)
}

func (handlers *MembershipLifecycleHandlers) leave(ctx *echo.Context) error {
	viewerID, authorized, err := handlers.authorize(ctx)
	if err != nil || !authorized {
		return err
	}
	if handlers.lifecycle == nil {
		return errors.New("Shared Vault membership lifecycle repository is not configured")
	}
	if err := handlers.lifecycle.Leave(ctx.Request().Context(), viewerID, ctx.Param("vaultId")); err != nil {
		if errors.Is(err, membershipapp.ErrMembershipUnavailable) {
			return ctx.JSON(http.StatusNotFound, httpapi.ApiError{Error: "viewer_membership_unavailable"})
		}
		return err
	}
	return ctx.NoContent(http.StatusNoContent)
}

func (handlers *MembershipLifecycleHandlers) authorize(ctx *echo.Context) (string, bool, error) {
	if handlers.authorizer == nil {
		return "", false, errors.New("application request authorizer is not configured")
	}
	userID, authorized, err := handlers.authorizer.AuthorizeApplicationRequest(ctx, "membership_mutation")
	if err != nil || !authorized {
		return "", authorized, err
	}
	if userID == "" {
		return "", false, errors.New("application request authorizer returned an empty user ID")
	}
	return userID, true, nil
}
