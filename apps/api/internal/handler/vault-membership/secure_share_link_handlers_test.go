package http

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/identity"
	membershipapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/vault-membership"
)

type secureShareUserAuthorizerStub struct {
	user       identityapp.ApplicationUser
	authorized bool
	mutations  []string
}

func (authorizer *secureShareUserAuthorizerStub) AuthorizeApplicationUserRequest(ctx *echo.Context, mutation string) (identityapp.ApplicationUser, bool, error) {
	authorizer.mutations = append(authorizer.mutations, mutation)
	if !authorizer.authorized {
		return identityapp.ApplicationUser{}, false, ctx.JSON(http.StatusUnauthorized, httpapi.ApiError{Error: "unauthenticated"})
	}
	return authorizer.user, true, nil
}

type secureShareLinkRepositoryStub struct {
	createCalls      int
	createOwner      string
	createVault      string
	createEmail      string
	createInput      membershipapp.NewSecureShareLink
	createInputCopy  membershipapp.NewSecureShareLink
	created          membershipapp.CreatedSecureShareLink
	createErr        error
	findCalls        int
	findRecipient    membershipapp.SecureShareLinkRecipient
	findVerifier     []byte
	findVerifierCopy []byte
	findLink         *membershipapp.RedeemableSecureShareLink
	findErr          error
	redeemCalls      int
	redeemRecipient  membershipapp.SecureShareLinkRecipient
	redeemInvitation string
	redeemKey        []byte
	redeemKeyCopy    []byte
	redeemKeyVersion int64
	redeemPublicKey  identityapp.UserEncryptionPublicKey
	redeemErr        error
}

func (repository *secureShareLinkRepositoryStub) CreateForEmail(_ context.Context, ownerID, vaultID, recipientEmail string, link membershipapp.NewSecureShareLink) (membershipapp.CreatedSecureShareLink, error) {
	repository.createCalls++
	repository.createOwner = ownerID
	repository.createVault = vaultID
	repository.createEmail = recipientEmail
	repository.createInput = link
	repository.createInputCopy = membershipapp.NewSecureShareLink{
		LinkVerifier: append([]byte(nil), link.LinkVerifier...), EncryptedPackage: append([]byte(nil), link.EncryptedPackage...),
		ExpectedKeyVersion: link.ExpectedKeyVersion,
	}
	return repository.created, repository.createErr
}

func (repository *secureShareLinkRepositoryStub) FindForRecipient(_ context.Context, recipient membershipapp.SecureShareLinkRecipient, verifier []byte) (*membershipapp.RedeemableSecureShareLink, error) {
	repository.findCalls++
	repository.findRecipient = recipient
	repository.findVerifier = verifier
	repository.findVerifierCopy = append([]byte(nil), verifier...)
	return repository.findLink, repository.findErr
}

func (repository *secureShareLinkRepositoryStub) Redeem(_ context.Context, recipient membershipapp.SecureShareLinkRecipient, invitationID string, encryptedVaultKey []byte, keyVersion int64, publicKey identityapp.UserEncryptionPublicKey) error {
	repository.redeemCalls++
	repository.redeemRecipient = recipient
	repository.redeemInvitation = invitationID
	repository.redeemKey = encryptedVaultKey
	repository.redeemKeyCopy = append([]byte(nil), encryptedVaultKey...)
	repository.redeemKeyVersion = keyVersion
	repository.redeemPublicKey = publicKey
	return repository.redeemErr
}

func TestSecureShareLinkCreateMapsEmailInvitationAndClearsVerifierAndPackage(t *testing.T) {
	createdAt := time.Date(2026, time.July, 29, 12, 0, 0, 0, time.UTC)
	verifier := make([]byte, 32)
	for index := range verifier {
		verifier[index] = byte(index + 1)
	}
	ciphertext := secureShareCiphertext(1, 13)
	body, err := json.Marshal(map[string]any{
		"recipientEmail":     " Invitee@Example.test ",
		"linkVerifier":       base64.StdEncoding.EncodeToString(verifier),
		"encryptedPackage":   base64.StdEncoding.EncodeToString(ciphertext),
		"expectedKeyVersion": 4,
	})
	if err != nil {
		t.Fatal(err)
	}
	authorizer := &secureShareUserAuthorizerStub{user: identityapp.ApplicationUser{ID: "synthetic-owner", Email: "owner@example.test", Status: "ACTIVE"}, authorized: true}
	repository := &secureShareLinkRepositoryStub{created: membershipapp.CreatedSecureShareLink{ID: "synthetic-invitation", ExpiresAt: createdAt.Add(7 * 24 * time.Hour)}}
	handler := NewSecureShareLinkHandlers(authorizer, repository).OperationHandlers()["postSharedvaultsVaultIdSharelinks"]
	response := invokeSecureShareLinkHandler(t, handler, http.MethodPost, "/v1/shared-vaults/synthetic-vault/share-links", string(body), "synthetic-vault")
	if response.Code != http.StatusCreated || authorizer.mutations[0] != "membership_mutation" || repository.createCalls != 1 ||
		repository.createOwner != "synthetic-owner" || repository.createVault != "synthetic-vault" || repository.createEmail != "Invitee@Example.test" ||
		repository.createInputCopy.ExpectedKeyVersion != 4 || string(repository.createInputCopy.LinkVerifier) != string(verifier) ||
		string(repository.createInputCopy.EncryptedPackage) != string(ciphertext) {
		t.Fatalf("Secure Share Link create response=%d %s auth=%#v repo=%#v", response.Code, response.Body.String(), authorizer, repository)
	}
	var result createdSecureShareLinkResponse
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode created invitation response: %v", err)
	}
	if result.ID != "synthetic-invitation" || result.ExpiresAt != "2026-08-05T12:00:00.000Z" {
		t.Fatalf("created invitation response=%#v", result)
	}
	if !secureShareBytesZero(repository.createInput.LinkVerifier) || !secureShareBytesZero(repository.createInput.EncryptedPackage) {
		t.Fatal("Secure Share Link verifier or package request buffer was not cleared")
	}
}

func TestSecureShareLinkLookupReturnsOnlyRecipientBoundEncryptedPackageAndClearsBuffers(t *testing.T) {
	verifier := make([]byte, 32)
	for index := range verifier {
		verifier[index] = byte(index + 3)
	}
	ciphertext := secureShareCiphertext(2, 14)
	expectedPackage := base64.StdEncoding.EncodeToString(ciphertext)
	repository := &secureShareLinkRepositoryStub{findLink: &membershipapp.RedeemableSecureShareLink{
		ID: "synthetic-invitation", VaultID: "synthetic-vault", EncryptedPackage: ciphertext, KeyVersion: 3,
	}}
	authorizer := &secureShareUserAuthorizerStub{user: identityapp.ApplicationUser{ID: "synthetic-recipient", Email: "recipient@example.test", Status: "ACTIVE"}, authorized: true}
	handler := NewSecureShareLinkHandlers(authorizer, repository).OperationHandlers()["getSecuresharelinks"]
	response := invokeSecureShareLinkHandler(t, handler, http.MethodGet, "/v1/secure-share-links?verifier="+base64.StdEncoding.EncodeToString(verifier), "", "")
	if response.Code != http.StatusOK || len(authorizer.mutations) != 1 || authorizer.mutations[0] != "" || repository.findCalls != 1 ||
		repository.findRecipient.UserID != "synthetic-recipient" || repository.findRecipient.Email != "recipient@example.test" ||
		string(repository.findVerifierCopy) != string(verifier) {
		t.Fatalf("Secure Share Link lookup response=%d %s auth=%#v repo=%#v", response.Code, response.Body.String(), authorizer, repository)
	}
	var result redeemableSecureShareLinkResponse
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode recipient invitation response: %v", err)
	}
	if result.ID != "synthetic-invitation" || result.VaultID != "synthetic-vault" || result.KeyVersion != 3 ||
		result.EncryptedPackage != expectedPackage {
		t.Fatalf("recipient invitation response=%#v", result)
	}
	if !secureShareBytesZero(repository.findVerifier) || !secureShareBytesZero(repository.findLink.EncryptedPackage) {
		t.Fatal("Secure Share Link verifier or package buffer was not cleared")
	}
}

func TestSecureShareLinkRedemptionMapsCurrentIdentityAndClearsKeyWrap(t *testing.T) {
	ciphertext := secureShareCiphertext(1, 15)
	body := `{"invitationId":"synthetic-invitation","encryptedVaultKey":"` + base64.StdEncoding.EncodeToString(ciphertext) +
		`","keyVersion":2,"expectedPublicKey":{"kty":"EC","crv":"P-256","x":"` + strings.Repeat("A", 43) +
		`","y":"` + strings.Repeat("B", 43) + `"}}`
	authorizer := &secureShareUserAuthorizerStub{user: identityapp.ApplicationUser{ID: "synthetic-recipient", Email: "recipient@example.test", Status: "ACTIVE"}, authorized: true}
	repository := &secureShareLinkRepositoryStub{}
	handler := NewSecureShareLinkHandlers(authorizer, repository).OperationHandlers()["postSecuresharelinks"]
	response := invokeSecureShareLinkHandler(t, handler, http.MethodPost, "/v1/secure-share-links", body, "")
	if response.Code != http.StatusNoContent || response.Body.Len() != 0 || repository.redeemCalls != 1 ||
		authorizer.mutations[0] != "membership_mutation" || repository.redeemRecipient.UserID != "synthetic-recipient" ||
		repository.redeemRecipient.Email != "recipient@example.test" || repository.redeemInvitation != "synthetic-invitation" ||
		repository.redeemKeyVersion != 2 || repository.redeemPublicKey.X != strings.Repeat("A", 43) || string(repository.redeemKeyCopy) != string(ciphertext) {
		t.Fatalf("Secure Share Link redemption response=%d %s auth=%#v repo=%#v", response.Code, response.Body.String(), authorizer, repository)
	}
	if !secureShareBytesZero(repository.redeemKey) {
		t.Fatal("Secure Share Link redemption key-wrap buffer was not cleared")
	}
}

func TestSecureShareLinkHandlersMapUnavailableAndRejectMalformedRequestsBeforePersistence(t *testing.T) {
	authorizer := &secureShareUserAuthorizerStub{user: identityapp.ApplicationUser{ID: "synthetic-user", Email: "user@example.test", Status: "ACTIVE"}, authorized: true}
	repository := &secureShareLinkRepositoryStub{createErr: membershipapp.ErrInvitationRecipientUnavailable}
	handlers := NewSecureShareLinkHandlers(authorizer, repository).OperationHandlers()
	ciphertext := base64.StdEncoding.EncodeToString(secureShareCiphertext(1, 16))
	validCreate := `{"recipientEmail":"recipient@example.test","linkVerifier":"` + base64.StdEncoding.EncodeToString(make([]byte, 32)) +
		`","encryptedPackage":"` + ciphertext + `","expectedKeyVersion":1}`
	response := invokeSecureShareLinkHandler(t, handlers["postSharedvaultsVaultIdSharelinks"], http.MethodPost, "/v1/shared-vaults/synthetic-vault/share-links", validCreate, "synthetic-vault")
	if response.Code != http.StatusNotFound || !strings.Contains(response.Body.String(), "shared_vault_or_recipient_unavailable") {
		t.Fatalf("unavailable invitation create response=%d %s", response.Code, response.Body.String())
	}
	invalidCreates := []string{
		strings.Replace(validCreate, `,"expectedKeyVersion":1`, "", 1),
		strings.Replace(validCreate, `"recipientEmail":"recipient@example.test"`, `"recipientEmail":"bad"`, 1),
		strings.Replace(validCreate, `"linkVerifier":"`+base64.StdEncoding.EncodeToString(make([]byte, 32))+`"`, `"linkVerifier":"bad"`, 1),
		strings.TrimSuffix(validCreate, "}") + `,"secret":"synthetic-forbidden-secret"}`,
	}
	for _, requestBody := range invalidCreates {
		response := invokeSecureShareLinkHandler(t, handlers["postSharedvaultsVaultIdSharelinks"], http.MethodPost, "/v1/shared-vaults/synthetic-vault/share-links", requestBody, "synthetic-vault")
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "invalid_share_link") {
			t.Errorf("invalid invitation create response=%d %s", response.Code, response.Body.String())
		}
	}
	repository.findLink = nil
	response = invokeSecureShareLinkHandler(t, handlers["getSecuresharelinks"], http.MethodGet, "/v1/secure-share-links?verifier=bad", "", "")
	if response.Code != http.StatusBadRequest || repository.findCalls != 0 {
		t.Fatalf("invalid lookup response=%d calls=%d %s", response.Code, repository.findCalls, response.Body.String())
	}
	response = invokeSecureShareLinkHandler(t, handlers["getSecuresharelinks"], http.MethodGet,
		"/v1/secure-share-links?verifier="+base64.StdEncoding.EncodeToString(make([]byte, 32)), "", "")
	if response.Code != http.StatusNotFound || !strings.Contains(response.Body.String(), "share_link_unavailable") {
		t.Fatalf("unavailable lookup response=%d %s", response.Code, response.Body.String())
	}
	invalidRedemption := []string{
		`{"invitationId":"synthetic-invitation","encryptedVaultKey":"` + ciphertext + `","keyVersion":1}`,
		`{"invitationId":"synthetic-invitation","encryptedVaultKey":"` + ciphertext + `","keyVersion":1,"expectedPublicKey":{"kty":"EC","crv":"P-256","x":"` + strings.Repeat("A", 43) + `","y":"` + strings.Repeat("B", 43) + `","d":"synthetic-private-key"}}`,
	}
	for _, requestBody := range invalidRedemption {
		response := invokeSecureShareLinkHandler(t, handlers["postSecuresharelinks"], http.MethodPost, "/v1/secure-share-links", requestBody, "")
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "invalid_redemption") {
			t.Errorf("invalid redemption response=%d %s", response.Code, response.Body.String())
		}
	}
	repository.redeemErr = membershipapp.ErrStaleRecipientEncryptionIdentity
	validRedemption := `{"invitationId":"synthetic-invitation","encryptedVaultKey":"` + ciphertext + `","keyVersion":1,"expectedPublicKey":{"kty":"EC","crv":"P-256","x":"` + strings.Repeat("A", 43) + `","y":"` + strings.Repeat("B", 43) + `"}}`
	response = invokeSecureShareLinkHandler(t, handlers["postSecuresharelinks"], http.MethodPost, "/v1/secure-share-links", validRedemption, "")
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "stale_user_encryption_identity") {
		t.Fatalf("stale identity redemption response=%d %s", response.Code, response.Body.String())
	}
	repository.redeemErr = membershipapp.ErrSecureShareLinkUnavailable
	response = invokeSecureShareLinkHandler(t, handlers["postSecuresharelinks"], http.MethodPost, "/v1/secure-share-links", validRedemption, "")
	if response.Code != http.StatusNotFound || !strings.Contains(response.Body.String(), "share_link_unavailable") {
		t.Fatalf("unavailable redemption response=%d %s", response.Code, response.Body.String())
	}
	authorizer.authorized = false
	beforeCalls := repository.redeemCalls
	response = invokeSecureShareLinkHandler(t, handlers["postSecuresharelinks"], http.MethodPost, "/v1/secure-share-links", "not-json", "")
	if response.Code != http.StatusUnauthorized || repository.redeemCalls != beforeCalls {
		t.Fatalf("unauthorized redemption response=%d calls=%d", response.Code, repository.redeemCalls)
	}
}

func invokeSecureShareLinkHandler(t *testing.T, handler httpapi.OperationHandler, method, path, body, vaultID string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	response := httptest.NewRecorder()
	ctx := echo.New().NewContext(request, response)
	if vaultID != "" {
		ctx.SetPathValues(echo.PathValues{{Name: "vaultId", Value: vaultID}})
	}
	if err := handler(ctx); err != nil {
		t.Fatalf("Secure Share Link handler returned error: %v", err)
	}
	return response
}

func secureShareCiphertext(version byte, length int) []byte {
	value := make([]byte, length)
	value[0] = version
	for index := 1; index < length; index++ {
		value[index] = byte(index + 31)
	}
	return value
}

func secureShareBytesZero(value []byte) bool {
	for _, current := range value {
		if current != 0 {
			return false
		}
	}
	return true
}
