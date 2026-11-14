package handler

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/labstack/echo/v5"

	apiEntity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
)

type PersonalAccountHandlers struct {
	authorizer httpapi.ApplicationRequestAuthorizer
	accounts   apiService.PersonalAccountRepository
}

func NewPersonalAccountHandlers(authorizer httpapi.ApplicationRequestAuthorizer, accounts apiService.PersonalAccountRepository) *PersonalAccountHandlers {
	return &PersonalAccountHandlers{authorizer: authorizer, accounts: accounts}
}

func (handlers *PersonalAccountHandlers) OperationHandlers() map[string]httpapi.OperationHandler {
	return map[string]httpapi.OperationHandler{
		"getVaultsVaultIdAccounts":           handlers.list,
		"postVaultsVaultIdAccountsMigration": handlers.migratePayload,
		"postVaultsVaultIdAccounts":          handlers.create,
		"patchVaultsVaultIdAccounts":         handlers.update,
		"deleteVaultsVaultIdAccounts":        handlers.delete,
		"putVaultsVaultIdAccounts":           handlers.restore,
	}
}

type personalAccountPayloadRequest struct {
	EncryptedPayload  string                      `json:"encryptedPayload"`
	EncryptionVersion httpapi.PositiveSafeInteger `json:"encryptionVersion"`
	Source            optionalAccountSource       `json:"source"`
}

type personalAccountUpdateRequest struct {
	EncryptedPayload  string                      `json:"encryptedPayload"`
	EncryptionVersion httpapi.PositiveSafeInteger `json:"encryptionVersion"`
	Source            optionalAccountSource       `json:"source"`
	AccountID         string                      `json:"accountId"`
	ExpectedRevision  httpapi.PositiveSafeInteger `json:"expectedRevision"`
}

type personalAccountDeleteRequest struct {
	AccountID        string                      `json:"accountId"`
	ExpectedRevision httpapi.PositiveSafeInteger `json:"expectedRevision"`
}

type personalAccountRestoreRequest struct {
	AccountID string `json:"accountId"`
}

type optionalAccountSource struct {
	Value string
	Set   bool
}

func (value *optionalAccountSource) UnmarshalJSON(raw []byte) error {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return errors.New("account source must be a supported string")
	}
	var source string
	if err := json.Unmarshal(trimmed, &source); err != nil || source != string(apiService.AccountCopySourceLocalVault) {
		return errors.New("account source must be a supported string")
	}
	value.Value = source
	value.Set = true
	return nil
}

type personalAccountResponse struct {
	ID                string `json:"id"`
	EncryptedPayload  string `json:"encryptedPayload"`
	EncryptionVersion int    `json:"encryptionVersion"`
	Revision          int64  `json:"revision"`
}

func (handlers *PersonalAccountHandlers) list(ctx *echo.Context) error {
	ownerID, authorized, err := handlers.authorize(ctx, "")
	if err != nil {
		return writeAccountUnavailable(ctx)
	}
	if !authorized {
		return nil
	}
	if handlers.accounts == nil {
		return writeAccountUnavailable(ctx)
	}
	accounts, err := handlers.accounts.List(ctx.Request().Context(), ownerID, ctx.Param("vaultId"))
	if err != nil {
		return writeAccountUnavailable(ctx)
	}
	defer clearPersonalAccountValues(accounts)
	response := make([]personalAccountResponse, len(accounts))
	for index := range accounts {
		response[index] = personalAccountResponse{
			ID:                accounts[index].ID,
			EncryptedPayload:  base64.StdEncoding.EncodeToString(accounts[index].EncryptedPayload),
			EncryptionVersion: accounts[index].EncryptionVersion,
			Revision:          accounts[index].Revision,
		}
	}
	return ctx.JSON(http.StatusOK, response)
}

func (handlers *PersonalAccountHandlers) create(ctx *echo.Context) error {
	ownerID, authorized, err := handlers.authorize(ctx, "account_mutation")
	if err != nil {
		return writeAccountUnavailable(ctx)
	}
	if !authorized {
		return nil
	}
	if handlers.accounts == nil {
		return writeAccountUnavailable(ctx)
	}
	request, err := httpapi.DecodeJSONBody[personalAccountPayloadRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || request.EncryptionVersion != 1 {
		return writeAccountError(ctx, http.StatusBadRequest, "invalid_account")
	}
	payload, err := decodePersonalAccountPayload(request.EncryptedPayload)
	if err != nil {
		return writeAccountError(ctx, http.StatusBadRequest, "invalid_account")
	}
	defer clear(payload)
	input := apiService.NewEncryptedAccount{EncryptedPayload: payload, EncryptionVersion: int(request.EncryptionVersion)}
	if request.Source.Set {
		input.Source = apiService.AccountCopySourceLocalVault
	}
	account, err := handlers.accounts.Create(ctx.Request().Context(), ownerID, ctx.Param("vaultId"), input)
	if err != nil {
		return writeAccountUnavailable(ctx)
	}
	defer account.Clear()
	return ctx.JSON(http.StatusCreated, map[string]any{"id": account.ID, "revision": account.Revision})
}

func (handlers *PersonalAccountHandlers) update(ctx *echo.Context) error {
	ownerID, authorized, err := handlers.authorize(ctx, "account_mutation")
	if err != nil {
		return writeAccountUnavailable(ctx)
	}
	if !authorized {
		return nil
	}
	if handlers.accounts == nil {
		return writeAccountUnavailable(ctx)
	}
	request, err := httpapi.DecodeJSONBody[personalAccountUpdateRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || request.EncryptionVersion != 1 || request.ExpectedRevision < 1 || !httpapi.ValidStringLength(request.AccountID, 1, 128) {
		return writeAccountError(ctx, http.StatusBadRequest, "invalid_account")
	}
	payload, err := decodePersonalAccountPayload(request.EncryptedPayload)
	if err != nil {
		return writeAccountError(ctx, http.StatusBadRequest, "invalid_account")
	}
	defer clear(payload)
	input := apiService.NewEncryptedAccount{EncryptedPayload: payload, EncryptionVersion: int(request.EncryptionVersion)}
	if request.Source.Set {
		input.Source = apiService.AccountCopySourceLocalVault
	}
	account, err := handlers.accounts.Update(
		ctx.Request().Context(), ownerID, ctx.Param("vaultId"), request.AccountID, int64(request.ExpectedRevision), input,
	)
	if err != nil {
		return writeAccountUnavailable(ctx)
	}
	if account == nil {
		return writeAccountError(ctx, http.StatusConflict, "stale_revision")
	}
	defer account.Clear()
	return ctx.JSON(http.StatusOK, map[string]any{"id": account.ID, "revision": account.Revision})
}

func (handlers *PersonalAccountHandlers) delete(ctx *echo.Context) error {
	ownerID, authorized, err := handlers.authorize(ctx, "account_mutation")
	if err != nil {
		return writeAccountUnavailable(ctx)
	}
	if !authorized {
		return nil
	}
	if handlers.accounts == nil {
		return writeAccountUnavailable(ctx)
	}
	request, err := httpapi.DecodeJSONBody[personalAccountDeleteRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || request.ExpectedRevision < 1 || !httpapi.ValidStringLength(request.AccountID, 1, 128) {
		return writeAccountError(ctx, http.StatusBadRequest, "invalid_account")
	}
	deleted, err := handlers.accounts.Delete(ctx.Request().Context(), ownerID, ctx.Param("vaultId"), request.AccountID, int64(request.ExpectedRevision))
	if err != nil {
		return writeAccountUnavailable(ctx)
	}
	if !deleted {
		return writeAccountError(ctx, http.StatusConflict, "stale_revision")
	}
	return ctx.NoContent(http.StatusNoContent)
}

func (handlers *PersonalAccountHandlers) restore(ctx *echo.Context) error {
	ownerID, authorized, err := handlers.authorize(ctx, "account_mutation")
	if err != nil {
		return writeAccountUnavailable(ctx)
	}
	if !authorized {
		return nil
	}
	if handlers.accounts == nil {
		return writeAccountUnavailable(ctx)
	}
	request, err := httpapi.DecodeJSONBody[personalAccountRestoreRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || !httpapi.ValidStringLength(request.AccountID, 1, 128) {
		return writeAccountError(ctx, http.StatusBadRequest, "invalid_account")
	}
	restored, err := handlers.accounts.Restore(ctx.Request().Context(), ownerID, ctx.Param("vaultId"), request.AccountID)
	if err != nil {
		return writeAccountUnavailable(ctx)
	}
	if !restored {
		return writeAccountError(ctx, http.StatusNotFound, "account_unavailable")
	}
	return ctx.NoContent(http.StatusNoContent)
}

func (handlers *PersonalAccountHandlers) authorize(ctx *echo.Context, mutation string) (string, bool, error) {
	if handlers.authorizer == nil {
		return "", false, errors.New("application request authorizer is unavailable")
	}
	return handlers.authorizer.AuthorizeApplicationRequest(ctx, mutation)
}

func decodePersonalAccountPayload(value string) ([]byte, error) {
	return httpapi.DecodeBoundedBase64(value, 13, httpapi.MaxEncryptedBlobBytes)
}

func clearPersonalAccountValues(accounts []apiEntity.EncryptedAuthenticatorAccount) {
	for index := range accounts {
		accounts[index].Clear()
	}
}

func writeAccountUnavailable(ctx *echo.Context) error {
	return writeAccountError(ctx, http.StatusNotFound, "vault_unavailable")
}

func writeAccountError(ctx *echo.Context, status int, code string) error {
	return ctx.JSON(status, httpapi.ApiError{Error: code})
}
