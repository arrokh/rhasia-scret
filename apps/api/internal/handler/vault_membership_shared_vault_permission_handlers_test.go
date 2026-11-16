package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"

	apiEntity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity"
	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
)

type sharedVaultPermissionRepositoryStub struct {
	readCalls int
	readOwner string
	readVault string
	defaults  *apiService.SharedVaultAccountPermissionDefaults
	readErr   error

	defaultUpdateCalls int
	defaultUpdateOwner string
	defaultUpdateVault string
	defaultRevision    int64
	defaultPermissions apiEntity.SharedVaultAccountPermissions
	defaultUpdate      apiService.SharedVaultPermissionUpdate[apiService.SharedVaultAccountPermissionDefaults]
	defaultUpdateErr   error

	memberUpdateCalls int
	memberOwner       string
	memberVault       string
	memberUser        string
	memberRevision    int64
	memberOverrides   apiEntity.SharedVaultAccountPermissionOverrides
	memberUpdate      apiService.SharedVaultPermissionUpdate[apiService.SharedVaultMemberPermissionState]
	memberUpdateErr   error
}

func (repository *sharedVaultPermissionRepositoryStub) ReadVaultDefaults(_ context.Context, ownerID string, vaultID string) (*apiService.SharedVaultAccountPermissionDefaults, error) {
	repository.readCalls++
	repository.readOwner = ownerID
	repository.readVault = vaultID
	return repository.defaults, repository.readErr
}

func (repository *sharedVaultPermissionRepositoryStub) UpdateVaultDefaults(_ context.Context, ownerID string, vaultID string, expectedRevision int64, permissions apiEntity.SharedVaultAccountPermissions) (apiService.SharedVaultPermissionUpdate[apiService.SharedVaultAccountPermissionDefaults], error) {
	repository.defaultUpdateCalls++
	repository.defaultUpdateOwner = ownerID
	repository.defaultUpdateVault = vaultID
	repository.defaultRevision = expectedRevision
	repository.defaultPermissions = permissions
	return repository.defaultUpdate, repository.defaultUpdateErr
}

func (repository *sharedVaultPermissionRepositoryStub) UpdateMemberOverrides(_ context.Context, ownerID string, vaultID string, memberUserID string, expectedRevision int64, overrides apiEntity.SharedVaultAccountPermissionOverrides) (apiService.SharedVaultPermissionUpdate[apiService.SharedVaultMemberPermissionState], error) {
	repository.memberUpdateCalls++
	repository.memberOwner = ownerID
	repository.memberVault = vaultID
	repository.memberUser = memberUserID
	repository.memberRevision = expectedRevision
	repository.memberOverrides = overrides
	return repository.memberUpdate, repository.memberUpdateErr
}

func TestSharedVaultPermissionHandlersReadAndUpdateOwnerDefaults(t *testing.T) {
	authorizer := &sharedVaultAccessAuthorizerStub{userID: "synthetic-owner", authorized: true}
	permissions := apiEntity.SharedVaultAccountPermissions{CanAddAccounts: true}
	repository := &sharedVaultPermissionRepositoryStub{
		defaults: &apiService.SharedVaultAccountPermissionDefaults{Permissions: permissions, Revision: 4},
		defaultUpdate: apiService.SharedVaultPermissionUpdate[apiService.SharedVaultAccountPermissionDefaults]{
			Status: apiService.SharedVaultPermissionUpdateUpdated,
			Value:  apiService.SharedVaultAccountPermissionDefaults{Permissions: apiEntity.SharedVaultAccountPermissions{CanEditAccounts: true}, Revision: 5},
		},
	}
	handlers := NewSharedVaultPermissionHandlers(authorizer, repository).OperationHandlers()
	request := httptest.NewRequest(http.MethodGet, "/v1/shared-vaults/synthetic-vault/member-permissions", nil)
	response := httptest.NewRecorder()
	context := echo.New().NewContext(request, response)
	context.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}})
	if err := handlers["getSharedvaultsVaultIdMemberpermissions"](context); err != nil {
		t.Fatalf("read default permissions: %v", err)
	}
	if response.Code != http.StatusOK || authorizer.mutation != "" || repository.readOwner != "synthetic-owner" || repository.readVault != "synthetic-vault" {
		t.Fatalf("read default permissions response=%d %s auth=%#v repository=%#v", response.Code, response.Body.String(), authorizer, repository)
	}
	var readBody map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &readBody); err != nil {
		t.Fatalf("decode permission defaults: %v", err)
	}
	if readBody["vaultDefaultAccountPermissionsRevision"] != float64(4) {
		t.Fatalf("unexpected default permission revision: %#v", readBody)
	}

	request = httptest.NewRequest(http.MethodPatch, "/v1/shared-vaults/synthetic-vault/member-permissions", strings.NewReader(`{"expectedRevision":4.0,"canAddAccounts":false,"canEditAccounts":true,"canDeleteAccounts":false}`))
	response = httptest.NewRecorder()
	context = echo.New().NewContext(request, response)
	context.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}})
	if err := handlers["patchSharedvaultsVaultIdMemberpermissions"](context); err != nil {
		t.Fatalf("update default permissions: %v", err)
	}
	if response.Code != http.StatusOK || authorizer.mutation != "membership_mutation" || repository.defaultUpdateCalls != 1 ||
		repository.defaultRevision != 4 || repository.defaultPermissions != (apiEntity.SharedVaultAccountPermissions{CanEditAccounts: true}) {
		t.Fatalf("update default permissions response=%d %s auth=%#v repository=%#v", response.Code, response.Body.String(), authorizer, repository)
	}
}

func TestSharedVaultPermissionOverridesPreserveExplicitNullAndMapStatuses(t *testing.T) {
	authorizer := &sharedVaultAccessAuthorizerStub{userID: "synthetic-owner", authorized: true}
	falseValue := false
	trueValue := true
	repository := &sharedVaultPermissionRepositoryStub{
		memberUpdate: apiService.SharedVaultPermissionUpdate[apiService.SharedVaultMemberPermissionState]{
			Status: apiService.SharedVaultPermissionUpdateUpdated,
			Value: apiService.SharedVaultMemberPermissionState{
				Overrides: apiEntity.SharedVaultAccountPermissionOverrides{CanAddAccounts: nil, CanEditAccounts: &falseValue, CanDeleteAccounts: &trueValue},
				Effective: apiEntity.EffectiveSharedVaultAccountPermissionsFor(
					apiEntity.SharedVaultMemberRoleViewer,
					apiEntity.SharedVaultAccountPermissions{},
					apiEntity.SharedVaultAccountPermissionOverrides{},
				),
				Revision: 7,
			},
		},
	}
	handlers := NewSharedVaultPermissionHandlers(authorizer, repository).OperationHandlers()
	body := `{"expectedRevision":6,"canAddAccounts":null,"canEditAccounts":false,"canDeleteAccounts":true}`
	request := httptest.NewRequest(http.MethodPatch, "/v1/shared-vaults/synthetic-vault/members/synthetic-viewer", strings.NewReader(body))
	response := httptest.NewRecorder()
	context := echo.New().NewContext(request, response)
	context.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}, {Name: "userId", Value: "synthetic-viewer"}})
	if err := handlers["patchSharedvaultsVaultIdMembersUserId"](context); err != nil {
		t.Fatalf("update member overrides: %v", err)
	}
	if response.Code != http.StatusOK || authorizer.mutation != "membership_mutation" || repository.memberOwner != "synthetic-owner" ||
		repository.memberVault != "synthetic-vault" || repository.memberUser != "synthetic-viewer" || repository.memberRevision != 6 ||
		repository.memberOverrides.CanAddAccounts != nil || repository.memberOverrides.CanEditAccounts == nil || *repository.memberOverrides.CanEditAccounts ||
		repository.memberOverrides.CanDeleteAccounts == nil || !*repository.memberOverrides.CanDeleteAccounts {
		t.Fatalf("member override response=%d %s auth=%#v repository=%#v", response.Code, response.Body.String(), authorizer, repository)
	}
	var responseBody map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &responseBody); err != nil {
		t.Fatalf("decode member permission response: %v", err)
	}
	overrides, ok := responseBody["permissionOverrides"].(map[string]any)
	if !ok || overrides["canAddAccounts"] != nil || overrides["canEditAccounts"] != false || overrides["canDeleteAccounts"] != true {
		t.Fatalf("nullable permission override response was not preserved: %#v", responseBody["permissionOverrides"])
	}

	repository.memberUpdate.Status = apiService.SharedVaultPermissionUpdateStale
	request = httptest.NewRequest(http.MethodPatch, "/v1/shared-vaults/synthetic-vault/members/synthetic-viewer", strings.NewReader(body))
	response = httptest.NewRecorder()
	context = echo.New().NewContext(request, response)
	context.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}, {Name: "userId", Value: "synthetic-viewer"}})
	if err := handlers["patchSharedvaultsVaultIdMembersUserId"](context); err != nil {
		t.Fatalf("stale member permission update: %v", err)
	}
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "stale_permissions_revision") {
		t.Fatalf("stale member permission response=%d %s", response.Code, response.Body.String())
	}
	repository.memberUpdate.Status = apiService.SharedVaultPermissionUpdateUnavailable
	request = httptest.NewRequest(http.MethodPatch, "/v1/shared-vaults/synthetic-vault/members/unavailable", strings.NewReader(body))
	response = httptest.NewRecorder()
	context = echo.New().NewContext(request, response)
	context.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}, {Name: "userId", Value: "unavailable"}})
	if err := handlers["patchSharedvaultsVaultIdMembersUserId"](context); err != nil {
		t.Fatalf("unavailable member permission update: %v", err)
	}
	if response.Code != http.StatusNotFound || !strings.Contains(response.Body.String(), "member_unavailable") {
		t.Fatalf("unavailable member permission response=%d %s", response.Code, response.Body.String())
	}
}

func TestSharedVaultPermissionHandlersRejectMissingNullableFieldsAndPropagateErrors(t *testing.T) {
	authorizer := &sharedVaultAccessAuthorizerStub{userID: "synthetic-owner", authorized: true}
	repository := &sharedVaultPermissionRepositoryStub{}
	handlers := NewSharedVaultPermissionHandlers(authorizer, repository).OperationHandlers()
	request := httptest.NewRequest(http.MethodPatch, "/v1/shared-vaults/synthetic-vault/members/synthetic-viewer", strings.NewReader(`{"expectedRevision":1,"canAddAccounts":null,"canEditAccounts":false}`))
	response := httptest.NewRecorder()
	context := echo.New().NewContext(request, response)
	context.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}, {Name: "userId", Value: "synthetic-viewer"}})
	if err := handlers["patchSharedvaultsVaultIdMembersUserId"](context); err != nil {
		t.Fatalf("missing member permission field: %v", err)
	}
	if response.Code != http.StatusBadRequest || repository.memberUpdateCalls != 0 {
		t.Fatalf("missing nullable permission field response=%d calls=%d", response.Code, repository.memberUpdateCalls)
	}

	authorizer.authorized = false
	request = httptest.NewRequest(http.MethodPatch, "/v1/shared-vaults/synthetic-vault/member-permissions", strings.NewReader("not-json"))
	response = httptest.NewRecorder()
	context = echo.New().NewContext(request, response)
	context.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}})
	if err := handlers["patchSharedvaultsVaultIdMemberpermissions"](context); err != nil {
		t.Fatalf("unauthorized default permission update: %v", err)
	}
	if response.Code != http.StatusUnauthorized || repository.defaultUpdateCalls != 0 {
		t.Fatalf("unauthorized default permission response=%d calls=%d", response.Code, repository.defaultUpdateCalls)
	}

	authorizer.authorized = true
	repository.readErr = errors.New("synthetic repository failure")
	request = httptest.NewRequest(http.MethodGet, "/v1/shared-vaults/synthetic-vault/member-permissions", nil)
	response = httptest.NewRecorder()
	context = echo.New().NewContext(request, response)
	context.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}})
	if err := handlers["getSharedvaultsVaultIdMemberpermissions"](context); !errors.Is(err, repository.readErr) {
		t.Fatalf("permission repository error=%v; want propagation to generic mapper", err)
	}
	if response.Body.Len() != 0 {
		t.Fatalf("permission repository error was mapped locally: %s", response.Body.String())
	}
}
