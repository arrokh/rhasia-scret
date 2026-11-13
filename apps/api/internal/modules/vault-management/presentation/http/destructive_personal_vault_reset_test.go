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
	vaultapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-management/application"
)

type destructivePersonalVaultResetRepositoryStub struct {
	eligibilityCalls int
	eligibilityUser  string
	eligibility      vaultapp.DestructivePersonalVaultResetEligibility
	eligibilityErr   error
	resetCalls       int
	resetUser        string
	resetErr         error
}

func (repository *destructivePersonalVaultResetRepositoryStub) GetEligibility(_ context.Context, userID string) (vaultapp.DestructivePersonalVaultResetEligibility, error) {
	repository.eligibilityCalls++
	repository.eligibilityUser = userID
	return repository.eligibility, repository.eligibilityErr
}

func (repository *destructivePersonalVaultResetRepositoryStub) Reset(_ context.Context, userID string) error {
	repository.resetCalls++
	repository.resetUser = userID
	return repository.resetErr
}

func TestDestructivePersonalVaultResetEligibilityIsAuthenticatedAndNotCached(t *testing.T) {
	eligibility := vaultapp.DestructivePersonalVaultResetEligibility{
		PasskeyRecoveryEnrolled:   true,
		ActiveOwnedSharedVaults:   1,
		ActiveOwnedSharedVaultIDs: []string{"synthetic-shared-vault"},
	}
	authorizer := &personalVaultAuthorizerStub{ownerID: "synthetic-owner", authorized: true}
	repository := &destructivePersonalVaultResetRepositoryStub{eligibility: eligibility}
	handler := NewHandlers(Dependencies{Authorizer: authorizer, Resets: repository}).OperationHandlers()["getPersonalvaultDestructivereset"]
	request := httptest.NewRequest(http.MethodGet, "/v1/personal-vault/destructive-reset", nil)
	response := httptest.NewRecorder()
	ctx := echo.New().NewContext(request, response)
	if err := handler(ctx); err != nil {
		t.Fatalf("eligibility handler: %v", err)
	}
	if response.Code != http.StatusOK || response.Header().Get(echo.HeaderCacheControl) != "no-store" {
		t.Fatalf("eligibility response status=%d cache-control=%q", response.Code, response.Header().Get(echo.HeaderCacheControl))
	}
	var result vaultapp.DestructivePersonalVaultResetEligibility
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode reset eligibility: %v", err)
	}
	if result.PasskeyRecoveryEnrolled != eligibility.PasskeyRecoveryEnrolled || result.ActiveOwnedSharedVaults != eligibility.ActiveOwnedSharedVaults ||
		len(result.ActiveOwnedSharedVaultIDs) != 1 || result.ActiveOwnedSharedVaultIDs[0] != "synthetic-shared-vault" ||
		authorizer.calls != 1 || authorizer.mutation != "" || repository.eligibilityCalls != 1 || repository.eligibilityUser != "synthetic-owner" {
		t.Fatalf("reset eligibility contract mismatch: result=%#v auth=%#v repository=%#v", result, authorizer, repository)
	}
}

func TestDestructivePersonalVaultResetRequiresExactConfirmationAndMapsBlockers(t *testing.T) {
	authorizer := &personalVaultAuthorizerStub{ownerID: "synthetic-owner", authorized: true}
	repository := &destructivePersonalVaultResetRepositoryStub{}
	handler := NewHandlers(Dependencies{Authorizer: authorizer, Resets: repository}).OperationHandlers()["postPersonalvaultDestructivereset"]

	for _, body := range []string{"not-json", `{}`, `{"confirmation":""}`, `{"confirmation":"HAPUS DATA BRANKAS","unexpected":true}`} {
		response := invokeDestructiveResetHandler(t, handler, body)
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "invalid_confirmation") {
			t.Errorf("invalid confirmation response=%d %s", response.Code, response.Body.String())
		}
	}
	if repository.resetCalls != 0 {
		t.Fatalf("invalid reset requests reached persistence %d times", repository.resetCalls)
	}

	success := invokeDestructiveResetHandler(t, handler, `{"confirmation":"HAPUS DATA BRANKAS"}`)
	if success.Code != http.StatusNoContent || success.Body.Len() != 0 || repository.resetCalls != 1 || repository.resetUser != "synthetic-owner" || authorizer.mutation != "destructive_mutation" {
		t.Fatalf("successful reset response=%d %s auth=%#v repository=%#v", success.Code, success.Body.String(), authorizer, repository)
	}

	repository.resetErr = vaultapp.PasskeyRecoveryAlreadyEnrolledError{}
	passkeyConflict := invokeDestructiveResetHandler(t, handler, `{"confirmation":"HAPUS DATA BRANKAS"}`)
	if passkeyConflict.Code != http.StatusConflict || !strings.Contains(passkeyConflict.Body.String(), "passkey_recovery_available") {
		t.Fatalf("passkey recovery blocker response=%d %s", passkeyConflict.Code, passkeyConflict.Body.String())
	}

	repository.resetErr = vaultapp.ActiveOwnedSharedVaultsPreventResetError{Count: 2}
	sharedVaultConflict := invokeDestructiveResetHandler(t, handler, `{"confirmation":"HAPUS DATA BRANKAS"}`)
	if sharedVaultConflict.Code != http.StatusConflict || !strings.Contains(sharedVaultConflict.Body.String(), `"count":2`) || !strings.Contains(sharedVaultConflict.Body.String(), "owned_shared_vaults_exist") {
		t.Fatalf("active owned Shared Vault blocker response=%d %s", sharedVaultConflict.Code, sharedVaultConflict.Body.String())
	}

	repository.resetErr = errors.New("synthetic database failure")
	failure := invokeDestructiveResetHandler(t, handler, `{"confirmation":"HAPUS DATA BRANKAS"}`)
	if failure.Code != http.StatusInternalServerError || !strings.Contains(failure.Body.String(), "destructive_reset_failed") || strings.Contains(failure.Body.String(), "synthetic database failure") {
		t.Fatalf("operational reset failure response=%d %s", failure.Code, failure.Body.String())
	}
}

func TestDestructivePersonalVaultResetRequiresAuthenticatedFreshMutation(t *testing.T) {
	authorizer := &personalVaultAuthorizerStub{authorized: false}
	repository := &destructivePersonalVaultResetRepositoryStub{}
	handlers := NewHandlers(Dependencies{Authorizer: authorizer, Resets: repository}).OperationHandlers()
	response := invokeDestructiveResetHandler(t, handlers["postPersonalvaultDestructivereset"], `{"confirmation":"HAPUS DATA BRANKAS"}`)
	if response.Code != http.StatusUnauthorized || repository.resetCalls != 0 || authorizer.mutation != "destructive_mutation" {
		t.Fatalf("unauthenticated reset response=%d repository calls=%d auth=%#v", response.Code, repository.resetCalls, authorizer)
	}
}

func invokeDestructiveResetHandler(t *testing.T, handler httpapi.OperationHandler, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/v1/personal-vault/destructive-reset", strings.NewReader(body))
	response := httptest.NewRecorder()
	ctx := echo.New().NewContext(request, response)
	if err := handler(ctx); err != nil {
		t.Fatalf("destructive reset handler: %v", err)
	}
	return response
}
