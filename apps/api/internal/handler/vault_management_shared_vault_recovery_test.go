package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"
)

type sharedVaultRecoveryRepositoryStub struct {
	deleteCalls int
	deleteOwner string
	deleteVault string
	deleted     bool
	deleteErr   error

	restoreCalls int
	restoreOwner string
	restoreVault string
	restored     bool
	restoreErr   error
}

func (repository *sharedVaultRecoveryRepositoryStub) Delete(_ context.Context, ownerID string, vaultID string) (bool, error) {
	repository.deleteCalls++
	repository.deleteOwner = ownerID
	repository.deleteVault = vaultID
	return repository.deleted, repository.deleteErr
}

func (repository *sharedVaultRecoveryRepositoryStub) Restore(_ context.Context, ownerID string, vaultID string) (bool, error) {
	repository.restoreCalls++
	repository.restoreOwner = ownerID
	repository.restoreVault = vaultID
	return repository.restored, repository.restoreErr
}

func TestSharedVaultRecoveryHandlersAuthorizeDeleteAndRestore(t *testing.T) {
	authorizer := &personalVaultAuthorizerStub{ownerID: "synthetic-owner", authorized: true}
	repository := &sharedVaultRecoveryRepositoryStub{deleted: true, restored: true}
	handlers := NewSharedVaultRecoveryHandlers(authorizer, repository).OperationHandlers()
	deleteResponse := invokeSharedVaultHandler(t, handlers["deleteSharedvaultsVaultIdLifecycle"], http.MethodDelete, "/v1/shared-vaults/synthetic-vault/lifecycle", "not-json", "synthetic-vault")
	if deleteResponse.Code != http.StatusNoContent || deleteResponse.Body.Len() != 0 || authorizer.mutation != "destructive_mutation" ||
		repository.deleteCalls != 1 || repository.deleteOwner != "synthetic-owner" || repository.deleteVault != "synthetic-vault" {
		t.Fatalf("Shared Vault delete response=%d %s auth=%#v repository=%#v", deleteResponse.Code, deleteResponse.Body.String(), authorizer, repository)
	}
	restoreResponse := invokeSharedVaultHandler(t, handlers["postSharedvaultsVaultIdLifecycle"], http.MethodPost, "/v1/shared-vaults/synthetic-vault/lifecycle", "", "synthetic-vault")
	if restoreResponse.Code != http.StatusNoContent || restoreResponse.Body.Len() != 0 || repository.restoreCalls != 1 ||
		repository.restoreOwner != "synthetic-owner" || repository.restoreVault != "synthetic-vault" {
		t.Fatalf("Shared Vault restore response=%d %s repository=%#v", restoreResponse.Code, restoreResponse.Body.String(), repository)
	}
}

func TestSharedVaultRecoveryHandlersMapUnavailableAndAuthentication(t *testing.T) {
	authorizer := &personalVaultAuthorizerStub{ownerID: "synthetic-owner", authorized: true}
	repository := &sharedVaultRecoveryRepositoryStub{}
	handlers := NewSharedVaultRecoveryHandlers(authorizer, repository).OperationHandlers()
	deleteResponse := invokeSharedVaultHandler(t, handlers["deleteSharedvaultsVaultIdLifecycle"], http.MethodDelete, "/v1/shared-vaults/synthetic-vault/lifecycle", "", "synthetic-vault")
	if deleteResponse.Code != http.StatusNotFound || !strings.Contains(deleteResponse.Body.String(), "shared_vault_unavailable") {
		t.Fatalf("unavailable delete response=%d %s", deleteResponse.Code, deleteResponse.Body.String())
	}
	restoreResponse := invokeSharedVaultHandler(t, handlers["postSharedvaultsVaultIdLifecycle"], http.MethodPost, "/v1/shared-vaults/synthetic-vault/lifecycle", "", "synthetic-vault")
	if restoreResponse.Code != http.StatusNotFound || !strings.Contains(restoreResponse.Body.String(), "shared_vault_unavailable") {
		t.Fatalf("unavailable restore response=%d %s", restoreResponse.Code, restoreResponse.Body.String())
	}
	authorizer.authorized = false
	response := invokeSharedVaultHandler(t, handlers["deleteSharedvaultsVaultIdLifecycle"], http.MethodDelete, "/v1/shared-vaults/synthetic-vault/lifecycle", "not-json", "synthetic-vault")
	if response.Code != http.StatusUnauthorized || repository.deleteCalls != 1 {
		t.Fatalf("unauthorized delete response=%d delete calls=%d", response.Code, repository.deleteCalls)
	}
}

func TestSharedVaultRecoveryHandlersPropagateRepositoryErrors(t *testing.T) {
	authorizer := &personalVaultAuthorizerStub{ownerID: "synthetic-owner", authorized: true}
	repository := &sharedVaultRecoveryRepositoryStub{deleteErr: errors.New("synthetic database failure")}
	handler := NewSharedVaultRecoveryHandlers(authorizer, repository).OperationHandlers()["deleteSharedvaultsVaultIdLifecycle"]
	request := httptest.NewRequest(http.MethodDelete, "/v1/shared-vaults/synthetic-vault/lifecycle", nil)
	response := httptest.NewRecorder()
	context := echo.New().NewContext(request, response)
	context.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}})
	if err := handler(context); !errors.Is(err, repository.deleteErr) {
		t.Fatalf("repository error=%v; want propagation to generic mapper", err)
	}
	if response.Body.Len() != 0 {
		t.Fatalf("repository error was mapped locally: %s", response.Body.String())
	}
}
