package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/labstack/echo/v5"

	apiEntity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
)

type SharedVaultPermissionHandlers struct {
	authorizer  httpapi.ApplicationRequestAuthorizer
	permissions apiService.SharedVaultAccountPermissionRepository
}

func NewSharedVaultPermissionHandlers(
	authorizer httpapi.ApplicationRequestAuthorizer,
	permissions apiService.SharedVaultAccountPermissionRepository,
) *SharedVaultPermissionHandlers {
	return &SharedVaultPermissionHandlers{authorizer: authorizer, permissions: permissions}
}

func (handlers *SharedVaultPermissionHandlers) OperationHandlers() map[string]httpapi.OperationHandler {
	return map[string]httpapi.OperationHandler{
		"getSharedvaultsVaultIdMemberpermissions":   handlers.readDefaults,
		"patchSharedvaultsVaultIdMemberpermissions": handlers.updateDefaults,
		"patchSharedvaultsVaultIdMembersUserId":     handlers.updateMemberOverrides,
	}
}

type sharedVaultDefaultsRequest struct {
	ExpectedRevision  httpapi.PositiveSafeInteger `json:"expectedRevision"`
	CanAddAccounts    *bool                       `json:"canAddAccounts"`
	CanEditAccounts   *bool                       `json:"canEditAccounts"`
	CanDeleteAccounts *bool                       `json:"canDeleteAccounts"`
}

type sharedVaultMemberOverridesRequest struct {
	ExpectedRevision  httpapi.PositiveSafeInteger `json:"expectedRevision"`
	CanAddAccounts    nullableBooleanRequest      `json:"canAddAccounts"`
	CanEditAccounts   nullableBooleanRequest      `json:"canEditAccounts"`
	CanDeleteAccounts nullableBooleanRequest      `json:"canDeleteAccounts"`
}

type nullableBooleanRequest struct {
	Present bool
	Value   *bool
}

func (value *nullableBooleanRequest) UnmarshalJSON(raw []byte) error {
	value.Present = true
	trimmed := bytes.TrimSpace(raw)
	if bytes.Equal(trimmed, []byte("null")) {
		value.Value = nil
		return nil
	}
	var parsed bool
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return httpapi.ErrInvalidJSONBody
	}
	value.Value = &parsed
	return nil
}

func (handlers *SharedVaultPermissionHandlers) readDefaults(ctx *echo.Context) error {
	userID, authorized, err := handlers.authorize(ctx, "")
	if err != nil || !authorized {
		return err
	}
	if handlers.permissions == nil {
		return errors.New("Shared Vault permission repository is not configured")
	}
	defaults, err := handlers.permissions.ReadVaultDefaults(ctx.Request().Context(), userID, ctx.Param("vaultId"))
	if err != nil {
		return err
	}
	if defaults == nil {
		return ctx.JSON(http.StatusNotFound, httpapi.ApiError{Error: "owner_access_required"})
	}
	return ctx.JSON(http.StatusOK, map[string]any{
		"vaultDefaultAccountPermissions":         defaults.Permissions,
		"vaultDefaultAccountPermissionsRevision": defaults.Revision,
	})
}

func (handlers *SharedVaultPermissionHandlers) updateDefaults(ctx *echo.Context) error {
	userID, authorized, err := handlers.authorize(ctx, "membership_mutation")
	if err != nil || !authorized {
		return err
	}
	if handlers.permissions == nil {
		return errors.New("Shared Vault permission repository is not configured")
	}
	request, err := httpapi.DecodeJSONBody[sharedVaultDefaultsRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || request.ExpectedRevision < 1 || request.CanAddAccounts == nil || request.CanEditAccounts == nil || request.CanDeleteAccounts == nil {
		return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "invalid_member_permissions"})
	}
	result, err := handlers.permissions.UpdateVaultDefaults(
		ctx.Request().Context(), userID, ctx.Param("vaultId"), int64(request.ExpectedRevision),
		apiEntity.SharedVaultAccountPermissions{
			CanAddAccounts: *request.CanAddAccounts, CanEditAccounts: *request.CanEditAccounts, CanDeleteAccounts: *request.CanDeleteAccounts,
		},
	)
	if err != nil {
		return err
	}
	switch result.Status {
	case apiService.SharedVaultPermissionUpdateUpdated:
		return ctx.JSON(http.StatusOK, map[string]any{
			"vaultDefaultAccountPermissions":         result.Value.Permissions,
			"vaultDefaultAccountPermissionsRevision": result.Value.Revision,
		})
	case apiService.SharedVaultPermissionUpdateStale:
		return ctx.JSON(http.StatusConflict, httpapi.ApiError{Error: "stale_permissions_revision"})
	case apiService.SharedVaultPermissionUpdateUnavailable:
		return ctx.JSON(http.StatusNotFound, httpapi.ApiError{Error: "owner_access_required"})
	default:
		return errors.New("Shared Vault default permission update returned an unsupported result")
	}
}

func (handlers *SharedVaultPermissionHandlers) updateMemberOverrides(ctx *echo.Context) error {
	ownerID, authorized, err := handlers.authorize(ctx, "membership_mutation")
	if err != nil || !authorized {
		return err
	}
	if handlers.permissions == nil {
		return errors.New("Shared Vault permission repository is not configured")
	}
	request, err := httpapi.DecodeJSONBody[sharedVaultMemberOverridesRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || request.ExpectedRevision < 1 || !request.CanAddAccounts.Present || !request.CanEditAccounts.Present || !request.CanDeleteAccounts.Present {
		return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "invalid_member_permissions"})
	}
	result, err := handlers.permissions.UpdateMemberOverrides(
		ctx.Request().Context(), ownerID, ctx.Param("vaultId"), ctx.Param("userId"), int64(request.ExpectedRevision),
		apiEntity.SharedVaultAccountPermissionOverrides{
			CanAddAccounts:    request.CanAddAccounts.Value,
			CanEditAccounts:   request.CanEditAccounts.Value,
			CanDeleteAccounts: request.CanDeleteAccounts.Value,
		},
	)
	if err != nil {
		return err
	}
	switch result.Status {
	case apiService.SharedVaultPermissionUpdateUpdated:
		return ctx.JSON(http.StatusOK, map[string]any{
			"permissionOverrides":         result.Value.Overrides,
			"effectiveAccountPermissions": result.Value.Effective,
			"permissionsRevision":         result.Value.Revision,
		})
	case apiService.SharedVaultPermissionUpdateStale:
		return ctx.JSON(http.StatusConflict, httpapi.ApiError{Error: "stale_permissions_revision"})
	case apiService.SharedVaultPermissionUpdateUnavailable:
		return ctx.JSON(http.StatusNotFound, httpapi.ApiError{Error: "member_unavailable"})
	default:
		return errors.New("Shared Vault member permission update returned an unsupported result")
	}
}

func (handlers *SharedVaultPermissionHandlers) authorize(ctx *echo.Context, mutation string) (string, bool, error) {
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
