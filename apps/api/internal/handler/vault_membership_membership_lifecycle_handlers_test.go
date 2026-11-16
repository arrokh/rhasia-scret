package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"

	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
)

type membershipLifecycleRepositoryStub struct {
	revokeCalls int
	revokeOwner string
	revokeVault string
	revokeUser  string
	revokeErr   error

	leaveCalls int
	leaveUser  string
	leaveVault string
	leaveErr   error
}

func (repository *membershipLifecycleRepositoryStub) Revoke(_ context.Context, ownerID string, vaultID string, memberUserID string) error {
	repository.revokeCalls++
	repository.revokeOwner = ownerID
	repository.revokeVault = vaultID
	repository.revokeUser = memberUserID
	return repository.revokeErr
}

func (repository *membershipLifecycleRepositoryStub) Leave(_ context.Context, viewerID string, vaultID string) error {
	repository.leaveCalls++
	repository.leaveUser = viewerID
	repository.leaveVault = vaultID
	return repository.leaveErr
}

func TestMembershipLifecycleHandlersRevokeAndLeaveAuthorizedViewers(t *testing.T) {
	authorizer := &sharedVaultAccessAuthorizerStub{userID: "synthetic-owner", authorized: true}
	repository := &membershipLifecycleRepositoryStub{}
	handlers := NewMembershipLifecycleHandlers(authorizer, repository).OperationHandlers()
	request := httptest.NewRequest(http.MethodDelete, "/v1/shared-vaults/synthetic-vault/members/synthetic-viewer", strings.NewReader(`{"ignored":"body"}`))
	response := httptest.NewRecorder()
	context := echo.New().NewContext(request, response)
	context.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}, {Name: "userId", Value: "synthetic-viewer"}})
	if err := handlers["deleteSharedvaultsVaultIdMembersUserId"](context); err != nil {
		t.Fatalf("revoke Viewer membership: %v", err)
	}
	if response.Code != http.StatusNoContent || response.Body.Len() != 0 || authorizer.mutation != "membership_mutation" ||
		repository.revokeCalls != 1 || repository.revokeOwner != "synthetic-owner" || repository.revokeVault != "synthetic-vault" || repository.revokeUser != "synthetic-viewer" {
		t.Fatalf("revoke response=%d %s auth=%#v repository=%#v", response.Code, response.Body.String(), authorizer, repository)
	}

	authorizer.userID = "synthetic-viewer"
	request = httptest.NewRequest(http.MethodPost, "/v1/shared-vaults/synthetic-vault/leave", nil)
	response = httptest.NewRecorder()
	context = echo.New().NewContext(request, response)
	context.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}})
	if err := handlers["postSharedvaultsVaultIdLeave"](context); err != nil {
		t.Fatalf("leave Shared Vault: %v", err)
	}
	if response.Code != http.StatusNoContent || repository.leaveCalls != 1 || repository.leaveUser != "synthetic-viewer" || repository.leaveVault != "synthetic-vault" {
		t.Fatalf("leave response=%d %s repository=%#v", response.Code, response.Body.String(), repository)
	}
}

func TestMembershipLifecycleHandlersMapUnavailableAndStopOnAuthentication(t *testing.T) {
	authorizer := &sharedVaultAccessAuthorizerStub{userID: "synthetic-owner", authorized: true}
	repository := &membershipLifecycleRepositoryStub{revokeErr: apiService.ErrMembershipUnavailable, leaveErr: apiService.ErrMembershipUnavailable}
	handlers := NewMembershipLifecycleHandlers(authorizer, repository).OperationHandlers()
	request := httptest.NewRequest(http.MethodDelete, "/v1/shared-vaults/synthetic-vault/members/unavailable", nil)
	response := httptest.NewRecorder()
	context := echo.New().NewContext(request, response)
	context.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}, {Name: "userId", Value: "unavailable"}})
	if err := handlers["deleteSharedvaultsVaultIdMembersUserId"](context); err != nil {
		t.Fatalf("unavailable membership revoke: %v", err)
	}
	if response.Code != http.StatusNotFound || !strings.Contains(response.Body.String(), "member_unavailable") {
		t.Fatalf("unavailable revoke response=%d %s", response.Code, response.Body.String())
	}

	authorizer.authorized = false
	request = httptest.NewRequest(http.MethodPost, "/v1/shared-vaults/synthetic-vault/leave", strings.NewReader("not-json"))
	response = httptest.NewRecorder()
	context = echo.New().NewContext(request, response)
	context.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}})
	if err := handlers["postSharedvaultsVaultIdLeave"](context); err != nil {
		t.Fatalf("unauthorized leave: %v", err)
	}
	if response.Code != http.StatusUnauthorized || repository.leaveCalls != 0 {
		t.Fatalf("unauthorized leave response=%d repository calls=%d", response.Code, repository.leaveCalls)
	}
}

func TestMembershipLifecycleHandlersPropagateUnexpectedRepositoryErrors(t *testing.T) {
	authorizer := &sharedVaultAccessAuthorizerStub{userID: "synthetic-owner", authorized: true}
	repository := &membershipLifecycleRepositoryStub{revokeErr: errors.New("synthetic database failure")}
	handler := NewMembershipLifecycleHandlers(authorizer, repository).OperationHandlers()["deleteSharedvaultsVaultIdMembersUserId"]
	request := httptest.NewRequest(http.MethodDelete, "/v1/shared-vaults/synthetic-vault/members/synthetic-viewer", nil)
	response := httptest.NewRecorder()
	context := echo.New().NewContext(request, response)
	context.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}, {Name: "userId", Value: "synthetic-viewer"}})
	if err := handler(context); !errors.Is(err, repository.revokeErr) {
		t.Fatalf("repository error=%v; want propagation to generic mapper", err)
	}
	if response.Body.Len() != 0 {
		t.Fatalf("unexpected repository error was mapped locally: %s", response.Body.String())
	}
}
