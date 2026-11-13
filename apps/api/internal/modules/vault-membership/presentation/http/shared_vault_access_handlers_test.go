package http

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	membershipapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-membership/application"
	membershipdomain "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-membership/domain"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

type sharedVaultAccessAuthorizerStub struct {
	userID     string
	authorized bool
	calls      int
	mutation   string
}

func (authorizer *sharedVaultAccessAuthorizerStub) AuthorizeApplicationRequest(ctx *echo.Context, mutation string) (string, bool, error) {
	authorizer.calls++
	authorizer.mutation = mutation
	if !authorizer.authorized {
		return "", false, ctx.JSON(http.StatusUnauthorized, httpapi.ApiError{Error: "unauthenticated"})
	}
	return authorizer.userID, true, nil
}

type sharedVaultAccessRepositoryStub struct {
	listCalls int
	listUser  string
	listed    []membershipapp.SharedVaultAccess
	listErr   error

	getCalls int
	getUser  string
	getVault string
	got      *membershipapp.SharedVaultAccess
	getErr   error

	migrationCalls   int
	migrationUser    string
	migrationVault   string
	migrationVersion int64
	migration        sharedapp.EncryptedPayloadMigration
	migrationBuffer  []byte
	migrationResult  sharedapp.EncryptedPayloadMigrationResult
	migrationErr     error
}

func (repository *sharedVaultAccessRepositoryStub) ListForMember(_ context.Context, userID string) ([]membershipapp.SharedVaultAccess, error) {
	repository.listCalls++
	repository.listUser = userID
	return repository.listed, repository.listErr
}

func (repository *sharedVaultAccessRepositoryStub) GetForMember(_ context.Context, userID string, vaultID string) (*membershipapp.SharedVaultAccess, error) {
	repository.getCalls++
	repository.getUser = userID
	repository.getVault = vaultID
	return repository.got, repository.getErr
}

func (repository *sharedVaultAccessRepositoryStub) MigrateKeyWrap(_ context.Context, userID string, vaultID string, expectedKeyVersion int64, migration sharedapp.EncryptedPayloadMigration) (sharedapp.EncryptedPayloadMigrationResult, error) {
	repository.migrationCalls++
	repository.migrationUser = userID
	repository.migrationVault = vaultID
	repository.migrationVersion = expectedKeyVersion
	repository.migrationBuffer = migration.ReplacementCiphertext
	repository.migration = migration
	repository.migration.ReplacementCiphertext = append([]byte(nil), migration.ReplacementCiphertext...)
	return repository.migrationResult, repository.migrationErr
}

func TestSharedVaultAccessHandlersListAuthorizedEncryptedContentsAndClearBuffers(t *testing.T) {
	authorizer := &sharedVaultAccessAuthorizerStub{userID: "synthetic-viewer", authorized: true}
	repository := &sharedVaultAccessRepositoryStub{listed: []membershipapp.SharedVaultAccess{syntheticSharedVaultAccess()}}
	handler := NewSharedVaultAccessHandlers(authorizer, repository).OperationHandlers()["getSharedvaults"]
	request := httptest.NewRequest(http.MethodGet, "/v1/shared-vaults", nil)
	response := httptest.NewRecorder()
	context := echo.New().NewContext(request, response)
	if err := handler(context); err != nil {
		t.Fatalf("list Shared Vault access: %v", err)
	}
	if response.Code != http.StatusOK || authorizer.calls != 1 || authorizer.mutation != "" ||
		repository.listCalls != 1 || repository.listUser != "synthetic-viewer" {
		t.Fatalf("Shared Vault list response=%d %s auth=%#v repository=%#v", response.Code, response.Body.String(), authorizer, repository)
	}
	var body []map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode Shared Vault list response: %v", err)
	}
	if len(body) != 1 || body[0]["vaultId"] != "synthetic-vault" || body[0]["role"] != "VIEWER" ||
		body[0]["encryptedName"] != "AQID" || body[0]["encryptedVaultKey"] != "BAUG" || len(body[0]) != 8 {
		t.Fatalf("unexpected Shared Vault list response: %#v", body)
	}
	accounts, ok := body[0]["accounts"].([]any)
	if !ok || len(accounts) != 1 {
		t.Fatalf("Shared Vault account response=%#v", body[0]["accounts"])
	}
	account, ok := accounts[0].(map[string]any)
	if !ok || account["id"] != "synthetic-account" || account["encryptedPayload"] != "BAUGBwgJ" ||
		account["encryptionVersion"] != float64(1) || account["revision"] != float64(2) || len(account) != 4 {
		t.Fatalf("unexpected Shared Vault account response: %#v", accounts[0])
	}
	if !sharedVaultAccessBuffersZero(repository.listed) {
		t.Fatal("Shared Vault ciphertext buffers were not cleared after response encoding")
	}
}

func TestSharedVaultAccessHandlerReadsDetailWithoutRoleAndMapsUnavailable(t *testing.T) {
	authorizer := &sharedVaultAccessAuthorizerStub{userID: "synthetic-owner", authorized: true}
	vault := syntheticSharedVaultAccess()
	repository := &sharedVaultAccessRepositoryStub{got: &vault}
	handler := NewSharedVaultAccessHandlers(authorizer, repository).OperationHandlers()["getSharedvaultsVaultId"]
	request := httptest.NewRequest(http.MethodGet, "/v1/shared-vaults/synthetic-vault", nil)
	response := httptest.NewRecorder()
	context := echo.New().NewContext(request, response)
	context.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}})
	if err := handler(context); err != nil {
		t.Fatalf("get Shared Vault access: %v", err)
	}
	if response.Code != http.StatusOK || repository.getCalls != 1 || repository.getUser != "synthetic-owner" || repository.getVault != "synthetic-vault" {
		t.Fatalf("Shared Vault detail response=%d %s repository=%#v", response.Code, response.Body.String(), repository)
	}
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode Shared Vault detail: %v", err)
	}
	if body["role"] != nil || body["encryptedName"] != "AQID" || body["encryptedVaultKey"] != "BAUG" || body["vaultId"] != "synthetic-vault" {
		t.Fatalf("unexpected Shared Vault detail response: %#v", body)
	}
	if !sharedVaultAccessValueZero(&vault) {
		t.Fatal("Shared Vault detail ciphertext buffers were not cleared after response encoding")
	}

	repository.got = nil
	request = httptest.NewRequest(http.MethodGet, "/v1/shared-vaults/unavailable-vault", nil)
	response = httptest.NewRecorder()
	context = echo.New().NewContext(request, response)
	context.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "unavailable-vault"}})
	if err := handler(context); err != nil {
		t.Fatalf("read unavailable Shared Vault: %v", err)
	}
	if response.Code != http.StatusNotFound || !strings.Contains(response.Body.String(), "shared_vault_unavailable") {
		t.Fatalf("unavailable Shared Vault response=%d %s", response.Code, response.Body.String())
	}
}

func TestSharedVaultAccessHandlersStopBeforeRepositoryOnAuthenticationFailureAndPropagateFailures(t *testing.T) {
	authorizer := &sharedVaultAccessAuthorizerStub{authorized: false}
	repository := &sharedVaultAccessRepositoryStub{}
	handlers := NewSharedVaultAccessHandlers(authorizer, repository).OperationHandlers()
	request := httptest.NewRequest(http.MethodGet, "/v1/shared-vaults", nil)
	response := httptest.NewRecorder()
	if err := handlers["getSharedvaults"](echo.New().NewContext(request, response)); err != nil {
		t.Fatalf("unauthorized Shared Vault list handler: %v", err)
	}
	if response.Code != http.StatusUnauthorized || repository.listCalls != 0 {
		t.Fatalf("unauthorized list response=%d repository calls=%d", response.Code, repository.listCalls)
	}

	authorizer.authorized = true
	authorizer.userID = "synthetic-viewer"
	repository.listErr = errors.New("synthetic repository failure")
	request = httptest.NewRequest(http.MethodGet, "/v1/shared-vaults", nil)
	response = httptest.NewRecorder()
	if err := handlers["getSharedvaults"](echo.New().NewContext(request, response)); !errors.Is(err, repository.listErr) {
		t.Fatalf("Shared Vault access error=%v; want propagation to generic HTTP mapper", err)
	}
	if response.Body.Len() != 0 {
		t.Fatalf("repository failure was mapped locally: %s", response.Body.String())
	}
}

func syntheticSharedVaultAccess() membershipapp.SharedVaultAccess {
	return membershipapp.SharedVaultAccess{
		VaultID: "synthetic-vault",
		Role:    membershipdomain.SharedVaultMemberRoleViewer,
		EffectiveAccountPermissions: membershipdomain.EffectiveSharedVaultAccountPermissions{
			Permissions: membershipdomain.SharedVaultAccountPermissions{CanAddAccounts: true},
			Sources: membershipdomain.SharedVaultAccountPermissionSources{
				CanAddAccounts:    membershipdomain.SharedVaultAccountPermissionSourceMember,
				CanEditAccounts:   membershipdomain.SharedVaultAccountPermissionSourceVault,
				CanDeleteAccounts: membershipdomain.SharedVaultAccountPermissionSourceVault,
			},
		},
		EncryptedName:     []byte{1, 2, 3},
		EncryptionVersion: 1,
		EncryptedVaultKey: []byte{4, 5, 6},
		KeyVersion:        1,
		Accounts: []membershipapp.SharedVaultAccountAccess{{
			ID: "synthetic-account", EncryptedPayload: []byte{4, 5, 6, 7, 8, 9}, EncryptionVersion: 1, Revision: 2,
		}},
	}
}

func sharedVaultAccessBuffersZero(vaults []membershipapp.SharedVaultAccess) bool {
	for index := range vaults {
		if !sharedVaultAccessValueZero(&vaults[index]) {
			return false
		}
	}
	return true
}

func sharedVaultAccessValueZero(vault *membershipapp.SharedVaultAccess) bool {
	if vault == nil || !sharedAccessBytesZero(vault.EncryptedName) || !sharedAccessBytesZero(vault.EncryptedVaultKey) {
		return false
	}
	for index := range vault.Accounts {
		if !sharedAccessBytesZero(vault.Accounts[index].EncryptedPayload) {
			return false
		}
	}
	return true
}

func sharedAccessBytesZero(value []byte) bool {
	for _, item := range value {
		if item != 0 {
			return false
		}
	}
	return true
}
