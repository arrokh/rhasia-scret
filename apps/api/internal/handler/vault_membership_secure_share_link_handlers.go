package handler

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
)

type SecureShareLinkHandlers struct {
	authorizer httpapi.ApplicationUserRequestAuthorizer
	links      apiService.SecureShareLinkRepository
}

func NewSecureShareLinkHandlers(
	authorizer httpapi.ApplicationUserRequestAuthorizer,
	links apiService.SecureShareLinkRepository,
) *SecureShareLinkHandlers {
	return &SecureShareLinkHandlers{authorizer: authorizer, links: links}
}

func (handlers *SecureShareLinkHandlers) OperationHandlers() map[string]httpapi.OperationHandler {
	return map[string]httpapi.OperationHandler{
		"postSharedvaultsVaultIdSharelinks": handlers.createInvitation,
		"getSecuresharelinks":               handlers.findForRecipient,
		"postSecuresharelinks":              handlers.redeem,
	}
}

type createSecureShareLinkRequest struct {
	RecipientEmail     string                      `json:"recipientEmail"`
	LinkVerifier       string                      `json:"linkVerifier"`
	EncryptedPackage   string                      `json:"encryptedPackage"`
	ExpectedKeyVersion httpapi.PositiveSafeInteger `json:"expectedKeyVersion"`
}

type redeemSecureShareLinkRequest struct {
	InvitationID      string                      `json:"invitationId"`
	EncryptedVaultKey string                      `json:"encryptedVaultKey"`
	KeyVersion        httpapi.PositiveSafeInteger `json:"keyVersion"`
	ExpectedPublicKey map[string]json.RawMessage  `json:"expectedPublicKey"`
}

type redeemableSecureShareLinkResponse struct {
	ID               string `json:"id"`
	VaultID          string `json:"vaultId"`
	EncryptedPackage string `json:"encryptedPackage"`
	KeyVersion       int64  `json:"keyVersion"`
}

type createdSecureShareLinkResponse struct {
	ID        string `json:"id"`
	ExpiresAt string `json:"expiresAt"`
}

func (handlers *SecureShareLinkHandlers) createInvitation(ctx *echo.Context) error {
	owner, authorized, err := handlers.authorize(ctx, "membership_mutation")
	if err != nil || !authorized {
		return err
	}
	if handlers.links == nil {
		return errors.New("Secure Share Link repository is not configured")
	}
	request, err := httpapi.DecodeJSONBody[createSecureShareLinkRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil {
		return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "invalid_share_link"})
	}
	recipientEmail := strings.TrimSpace(request.RecipientEmail)
	if !httpapi.ValidStringLength(recipientEmail, 1, apiService.MaxInvitationRecipientEmailLength) ||
		!apiService.IsValidPasswordlessEmail(recipientEmail) || request.ExpectedKeyVersion < 1 {
		return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "invalid_share_link"})
	}
	linkVerifier, err := httpapi.DecodeBoundedBase64(request.LinkVerifier, 32, 32)
	if err != nil {
		return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "invalid_share_link"})
	}
	defer clear(linkVerifier)
	encryptedPackage, err := httpapi.DecodeBoundedBase64(request.EncryptedPackage, 13, httpapi.MaxEncryptedBlobBytes)
	if err != nil {
		return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "invalid_share_link"})
	}
	defer clear(encryptedPackage)
	link, err := handlers.links.CreateForEmail(ctx.Request().Context(), owner.ID, ctx.Param("vaultId"), recipientEmail, apiService.NewSecureShareLink{
		LinkVerifier: linkVerifier, EncryptedPackage: encryptedPackage, ExpectedKeyVersion: int64(request.ExpectedKeyVersion),
	})
	if errors.Is(err, apiService.ErrInvitationRecipientUnavailable) {
		return ctx.JSON(http.StatusNotFound, httpapi.ApiError{Error: "shared_vault_or_recipient_unavailable"})
	}
	if errors.Is(err, apiService.ErrInvitationConflict) {
		return ctx.JSON(http.StatusConflict, httpapi.ApiError{Error: "invitation_conflict"})
	}
	if err != nil {
		return err
	}
	return ctx.JSON(http.StatusCreated, createdSecureShareLinkResponse{
		ID: link.ID, ExpiresAt: link.ExpiresAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	})
}

func (handlers *SecureShareLinkHandlers) findForRecipient(ctx *echo.Context) error {
	recipient, authorized, err := handlers.authorize(ctx, "")
	if err != nil || !authorized {
		return err
	}
	if handlers.links == nil {
		return errors.New("Secure Share Link repository is not configured")
	}
	verifier, err := httpapi.DecodeBoundedBase64(ctx.QueryParams().Get("verifier"), 32, 32)
	if err != nil {
		return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "invalid_share_link"})
	}
	defer clear(verifier)
	link, err := handlers.links.FindForRecipient(ctx.Request().Context(), apiService.SecureShareLinkRecipient{
		UserID: recipient.ID, Email: recipient.Email,
	}, verifier)
	if err != nil {
		return err
	}
	if link == nil {
		return ctx.JSON(http.StatusNotFound, httpapi.ApiError{Error: "share_link_unavailable"})
	}
	defer clear(link.EncryptedPackage)
	return ctx.JSON(http.StatusOK, redeemableSecureShareLinkResponse{
		ID: link.ID, VaultID: link.VaultID,
		EncryptedPackage: base64.StdEncoding.EncodeToString(link.EncryptedPackage),
		KeyVersion:       link.KeyVersion,
	})
}

func (handlers *SecureShareLinkHandlers) redeem(ctx *echo.Context) error {
	recipient, authorized, err := handlers.authorize(ctx, "membership_mutation")
	if err != nil || !authorized {
		return err
	}
	if handlers.links == nil {
		return errors.New("Secure Share Link repository is not configured")
	}
	request, err := httpapi.DecodeJSONBody[redeemSecureShareLinkRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || !httpapi.ValidStringLength(request.InvitationID, 1, 128) || request.KeyVersion < 1 {
		return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "invalid_redemption"})
	}
	publicKeyJSON, err := json.Marshal(request.ExpectedPublicKey)
	if err != nil {
		return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "invalid_redemption"})
	}
	publicKey, err := apiService.ParseUserEncryptionPublicKey(publicKeyJSON)
	if err != nil {
		return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "invalid_redemption"})
	}
	encryptedVaultKey, err := httpapi.DecodeBoundedBase64(request.EncryptedVaultKey, 13, httpapi.MaxEncryptedBlobBytes)
	if err != nil {
		return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "invalid_redemption"})
	}
	defer clear(encryptedVaultKey)
	err = handlers.links.Redeem(ctx.Request().Context(), apiService.SecureShareLinkRecipient{
		UserID: recipient.ID, Email: recipient.Email,
	}, request.InvitationID, encryptedVaultKey, int64(request.KeyVersion), publicKey)
	if errors.Is(err, apiService.ErrStaleRecipientEncryptionIdentity) {
		return ctx.JSON(http.StatusConflict, httpapi.ApiError{Error: "stale_user_encryption_identity"})
	}
	if errors.Is(err, apiService.ErrSecureShareLinkUnavailable) {
		return ctx.JSON(http.StatusNotFound, httpapi.ApiError{Error: "share_link_unavailable"})
	}
	if err != nil {
		return err
	}
	return ctx.NoContent(http.StatusNoContent)
}

func (handlers *SecureShareLinkHandlers) authorize(ctx *echo.Context, mutation string) (apiService.ApplicationUser, bool, error) {
	if handlers.authorizer == nil {
		return apiService.ApplicationUser{}, false, errors.New("application User request authorizer is not configured")
	}
	user, authorized, err := handlers.authorizer.AuthorizeApplicationUserRequest(ctx, mutation)
	if err != nil || !authorized {
		return apiService.ApplicationUser{}, authorized, err
	}
	if user.ID == "" || user.Email == "" {
		return apiService.ApplicationUser{}, false, errors.New("application request authorizer returned an incomplete user")
	}
	return user, true, nil
}
