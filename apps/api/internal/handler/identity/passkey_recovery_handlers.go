package http

import (
	"bytes"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strings"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/protocol/webauthncose"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/labstack/echo/v5"

	identityinfra "github.com/nooroctavian/rhasia-scret/apps/api/internal/adapter/identity"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/identity"
)

type passkeyRecoveryRegistrationOptionsResponse struct {
	Challenge              protocol.URLEncodedBase64           `json:"challenge"`
	RelyingParty           protocol.RelyingPartyEntity         `json:"rp"`
	User                   protocol.UserEntity                 `json:"user"`
	Parameters             []protocol.CredentialParameter      `json:"pubKeyCredParams,omitempty"`
	Timeout                int                                 `json:"timeout,omitempty"`
	CredentialExcludeList  []protocol.CredentialDescriptor     `json:"excludeCredentials"`
	AuthenticatorSelection protocol.AuthenticatorSelection     `json:"authenticatorSelection,omitzero"`
	Hints                  []protocol.PublicKeyCredentialHints `json:"hints"`
	Attestation            protocol.ConveyancePreference       `json:"attestation,omitempty"`
	AttestationFormats     []protocol.AttestationFormat        `json:"attestationFormats,omitempty"`
	Extensions             protocol.AuthenticationExtensions   `json:"extensions,omitzero"`
}

type passkeyRecoveryAuthenticationOptionsResponse struct {
	Challenge          protocol.URLEncodedBase64            `json:"challenge"`
	Timeout            int                                  `json:"timeout,omitempty"`
	RelyingPartyID     string                               `json:"rpId,omitempty"`
	AllowedCredentials []protocol.CredentialDescriptor      `json:"allowCredentials,omitempty"`
	UserVerification   protocol.UserVerificationRequirement `json:"userVerification,omitempty"`
	EncryptedPackage   string                               `json:"encryptedRecoveryPackage"`
}

type passkeyRecoveryRegistrationVerifyRequest struct {
	Response                 json.RawMessage `json:"response"`
	EncryptedRecoveryPackage string          `json:"encryptedRecoveryPackage"`
}

type passkeyRecoveryAuthenticationVerifyRequest struct {
	Response json.RawMessage `json:"response"`
}

type passkeyRecoveryWebAuthnUser struct {
	id          []byte
	name        string
	credentials []webauthn.Credential
}

func (user passkeyRecoveryWebAuthnUser) WebAuthnID() []byte {
	return user.id
}

func (user passkeyRecoveryWebAuthnUser) WebAuthnName() string {
	return user.name
}

func (user passkeyRecoveryWebAuthnUser) WebAuthnDisplayName() string {
	return ""
}

func (user passkeyRecoveryWebAuthnUser) WebAuthnCredentials() []webauthn.Credential {
	return user.credentials
}

func (handlers *Handlers) passkeyRecoveryRegistrationOptions(ctx *echo.Context) error {
	user, authorized, err := handlers.authorizeApplicationRequest(ctx, "recovery_mutation")
	if err != nil || !authorized {
		return err
	}
	if handlers.dependencies.PasskeyRecovery == nil || !passkeyRecoveryWebAuthnConfigured(handlers.dependencies.PasskeyRecoveryWebAuthn) {
		return writeAPIError(ctx, http.StatusServiceUnavailable, "passkey_recovery_unavailable")
	}
	credential, err := handlers.dependencies.PasskeyRecovery.GetCredential(ctx.Request().Context(), user.ID)
	if err != nil {
		return writeAPIError(ctx, http.StatusServiceUnavailable, "passkey_recovery_unavailable")
	}
	if credential != nil {
		defer credential.Clear()
	}
	webUser := passkeyRecoveryWebAuthnUser{id: []byte(user.ID), name: user.Email}
	registrationOptions := []webauthn.RegistrationOption{
		webauthn.WithCredentialParameters(passkeyRecoveryCredentialParameters()),
		webauthn.WithResidentKeyRequirement(protocol.ResidentKeyRequirementRequired),
		webauthn.WithExtensions(webauthn.WithExtensionPRFSupport(), webauthn.WithExtensionCredProps()),
	}
	if credential != nil {
		registrationOptions = append(registrationOptions, webauthn.WithExclusions([]protocol.CredentialDescriptor{{
			Type:         protocol.PublicKeyCredentialType,
			CredentialID: protocol.URLEncodedBase64(credential.CredentialID),
		}}))
	}
	options, session, err := handlers.dependencies.PasskeyRecoveryWebAuthn.BeginRegistration(webUser, registrationOptions...)
	if err != nil {
		return writeAPIError(ctx, http.StatusServiceUnavailable, "passkey_recovery_unavailable")
	}
	if err := handlers.dependencies.PasskeyRecovery.IssueChallenge(ctx.Request().Context(), user.ID, identityapp.PasskeyRecoveryRegistrationPurpose, session.Challenge); err != nil {
		return writeAPIError(ctx, http.StatusServiceUnavailable, "passkey_recovery_unavailable")
	}
	excludeCredentials := options.Response.CredentialExcludeList
	if excludeCredentials == nil {
		excludeCredentials = []protocol.CredentialDescriptor{}
	}
	// Match @simplewebauthn/server's 60-second public registration timeout.
	timeout := 60_000
	response := passkeyRecoveryRegistrationOptionsResponse{
		Challenge: options.Response.Challenge, RelyingParty: options.Response.RelyingParty,
		User: options.Response.User, Parameters: options.Response.Parameters, Timeout: timeout,
		CredentialExcludeList:  excludeCredentials,
		AuthenticatorSelection: options.Response.AuthenticatorSelection,
		Hints:                  []protocol.PublicKeyCredentialHints{},
		Attestation:            options.Response.Attestation, AttestationFormats: options.Response.AttestationFormats,
		Extensions: options.Response.Extensions,
	}
	return ctx.JSON(http.StatusOK, response)
}

func (handlers *Handlers) passkeyRecoveryRegistrationVerify(ctx *echo.Context) error {
	user, authorized, err := handlers.authorizeApplicationRequest(ctx, "recovery_mutation")
	if err != nil || !authorized {
		return err
	}
	body, err := httpapi.DecodeJSONBody[passkeyRecoveryRegistrationVerifyRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || len(body.Response) == 0 || !json.Valid(body.Response) {
		return writeAPIError(ctx, http.StatusBadRequest, "invalid_passkey_recovery")
	}
	defer clear(body.Response)
	encryptedPackage, err := httpapi.DecodeBoundedBase64(body.EncryptedRecoveryPackage, 13, httpapi.MaxEncryptedBlobBytes)
	if err != nil {
		return writeAPIError(ctx, http.StatusBadRequest, "invalid_passkey_recovery")
	}
	defer clear(encryptedPackage)
	if handlers.dependencies.PasskeyRecovery == nil {
		return writeAPIError(ctx, http.StatusBadRequest, "passkey_verification_failed")
	}
	challenge, err := handlers.dependencies.PasskeyRecovery.ConsumeChallenge(ctx.Request().Context(), user.ID, identityapp.PasskeyRecoveryRegistrationPurpose)
	if err != nil {
		return writeAPIError(ctx, http.StatusBadRequest, "passkey_verification_failed")
	}
	if challenge == "" {
		return writeAPIError(ctx, http.StatusBadRequest, "passkey_challenge_expired")
	}
	prfEnabled, safeExtensions := passkeyRecoveryRegistrationExtensions(body.Response)
	if !safeExtensions {
		return writeAPIError(ctx, http.StatusBadRequest, "passkey_verification_failed")
	}
	if credentialID, isE2E := identityinfra.BrowserE2ERegistrationCredential(body.Response, handlers.dependencies.NodeEnvironment, handlers.dependencies.E2EBrowserTests); isE2E {
		defer clear(credentialID)
		registration := identityapp.PasskeyRecoveryRegistration{
			CredentialID: credentialID, PublicKey: []byte{1, 2, 3, 4}, Counter: 0,
			Transports: []string{"internal"}, EncryptedRecoveryPackage: encryptedPackage,
		}
		defer registration.Clear()
		if err := handlers.dependencies.PasskeyRecovery.SaveCredential(ctx.Request().Context(), user.ID, registration); err != nil {
			return writeAPIError(ctx, http.StatusBadRequest, "passkey_verification_failed")
		}
		return ctx.NoContent(http.StatusNoContent)
	}
	if !passkeyRecoveryWebAuthnConfigured(handlers.dependencies.PasskeyRecoveryWebAuthn) {
		return writeAPIError(ctx, http.StatusBadRequest, "passkey_verification_failed")
	}
	parsedResponse, err := protocol.ParseCredentialCreationResponseBytes(body.Response)
	if err != nil {
		return writeAPIError(ctx, http.StatusBadRequest, "passkey_verification_failed")
	}
	webUser := passkeyRecoveryWebAuthnUser{id: []byte(user.ID), name: user.Email}
	session := webauthn.SessionData{
		Challenge: challenge, RelyingPartyID: handlers.dependencies.PasskeyRecoveryWebAuthn.Config.RPID,
		UserID: webUser.WebAuthnID(), UserVerification: protocol.VerificationRequired,
		Extensions: protocol.SessionExtensions{Requested: []string{protocol.ExtensionPRF}},
		CredParams: passkeyRecoveryCredentialParameters(),
	}
	credential, err := handlers.dependencies.PasskeyRecoveryWebAuthn.CreateCredential(webUser, session, parsedResponse)
	if err != nil {
		return writeAPIError(ctx, http.StatusBadRequest, "passkey_verification_failed")
	}
	defer clear(credential.ID)
	defer clear(credential.PublicKey)
	if !prfEnabled {
		return writeAPIError(ctx, http.StatusBadRequest, "passkey_prf_required")
	}
	registration := identityapp.PasskeyRecoveryRegistration{
		CredentialID: credential.ID, PublicKey: credential.PublicKey,
		Counter:                  int64(credential.Authenticator.SignCount),
		EncryptedRecoveryPackage: encryptedPackage,
	}
	for _, transport := range credential.Transport {
		registration.Transports = append(registration.Transports, string(transport))
	}
	defer registration.Clear()
	if err := handlers.dependencies.PasskeyRecovery.SaveCredential(ctx.Request().Context(), user.ID, registration); err != nil {
		return writeAPIError(ctx, http.StatusBadRequest, "passkey_verification_failed")
	}
	return ctx.NoContent(http.StatusNoContent)
}

func (handlers *Handlers) passkeyRecoveryAuthenticationOptions(ctx *echo.Context) error {
	user, authorized, err := handlers.authorizeApplicationRequest(ctx, "recovery_authentication")
	if err != nil || !authorized {
		return err
	}
	if handlers.dependencies.PasskeyRecovery == nil || !passkeyRecoveryWebAuthnConfigured(handlers.dependencies.PasskeyRecoveryWebAuthn) {
		return writeAPIError(ctx, http.StatusServiceUnavailable, "passkey_recovery_unavailable")
	}
	credential, err := handlers.dependencies.PasskeyRecovery.GetCredential(ctx.Request().Context(), user.ID)
	if err != nil {
		return writeAPIError(ctx, http.StatusServiceUnavailable, "passkey_recovery_unavailable")
	}
	if credential == nil {
		return writeAPIError(ctx, http.StatusNotFound, "passkey_recovery_unavailable")
	}
	defer credential.Clear()
	webUser := passkeyRecoveryWebAuthnUser{
		id: []byte(user.ID), name: user.Email,
		credentials: []webauthn.Credential{{ID: credential.CredentialID}},
	}
	options, session, err := handlers.dependencies.PasskeyRecoveryWebAuthn.BeginLogin(webUser)
	if err != nil {
		return writeAPIError(ctx, http.StatusServiceUnavailable, "passkey_recovery_unavailable")
	}
	if err := handlers.dependencies.PasskeyRecovery.IssueChallenge(ctx.Request().Context(), user.ID, identityapp.PasskeyRecoveryAuthenticationPurpose, session.Challenge); err != nil {
		return writeAPIError(ctx, http.StatusServiceUnavailable, "passkey_recovery_unavailable")
	}
	allowed := make([]protocol.CredentialDescriptor, 0, len(options.Response.AllowedCredentials))
	for _, descriptor := range options.Response.AllowedCredentials {
		allowed = append(allowed, protocol.CredentialDescriptor{Type: descriptor.Type, CredentialID: descriptor.CredentialID})
	}
	// Match @simplewebauthn/server's 60-second public authentication timeout.
	response := passkeyRecoveryAuthenticationOptionsResponse{
		Challenge: options.Response.Challenge, Timeout: 60_000,
		RelyingPartyID: options.Response.RelyingPartyID, AllowedCredentials: allowed,
		UserVerification: options.Response.UserVerification,
		EncryptedPackage: base64.StdEncoding.EncodeToString(credential.EncryptedRecoveryPackage),
	}
	ctx.Response().Header().Set(echo.HeaderCacheControl, "no-store")
	return ctx.JSON(http.StatusOK, response)
}

func (handlers *Handlers) passkeyRecoveryAuthenticationVerify(ctx *echo.Context) error {
	user, authorized, err := handlers.authorizeApplicationRequest(ctx, "recovery_authentication")
	if err != nil || !authorized {
		return err
	}
	body, err := httpapi.DecodeJSONBody[passkeyRecoveryAuthenticationVerifyRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || len(body.Response) == 0 || !json.Valid(body.Response) {
		return writeAPIError(ctx, http.StatusBadRequest, "invalid_passkey_recovery")
	}
	defer clear(body.Response)
	if handlers.dependencies.PasskeyRecovery == nil {
		return writeAPIError(ctx, http.StatusBadRequest, "passkey_verification_failed")
	}
	challenge, err := handlers.dependencies.PasskeyRecovery.ConsumeChallenge(ctx.Request().Context(), user.ID, identityapp.PasskeyRecoveryAuthenticationPurpose)
	if err != nil {
		return writeAPIError(ctx, http.StatusBadRequest, "passkey_verification_failed")
	}
	credential, err := handlers.dependencies.PasskeyRecovery.GetCredential(ctx.Request().Context(), user.ID)
	if err != nil {
		return writeAPIError(ctx, http.StatusBadRequest, "passkey_verification_failed")
	}
	if challenge == "" || credential == nil {
		if credential != nil {
			credential.Clear()
		}
		return writeAPIError(ctx, http.StatusBadRequest, "passkey_challenge_expired")
	}
	defer credential.Clear()
	if !passkeyRecoveryAuthenticationExtensionsSafe(body.Response) {
		return writeAPIError(ctx, http.StatusBadRequest, "passkey_verification_failed")
	}
	if identityinfra.BrowserE2EAuthenticationVerified(body.Response, credential.CredentialID, handlers.dependencies.NodeEnvironment, handlers.dependencies.E2EBrowserTests) {
		if credential.Counter == math.MaxInt64 {
			return writeAPIError(ctx, http.StatusBadRequest, "passkey_verification_failed")
		}
		updated, err := handlers.dependencies.PasskeyRecovery.UpdateCounter(ctx.Request().Context(), user.ID, credential.CredentialID, credential.Counter, credential.Counter+1)
		if err != nil || !updated {
			return writeAPIError(ctx, http.StatusBadRequest, "passkey_verification_failed")
		}
		return ctx.JSON(http.StatusOK, map[string]string{"encryptedRecoveryPackage": base64.StdEncoding.EncodeToString(credential.EncryptedRecoveryPackage)})
	}
	if !passkeyRecoveryWebAuthnConfigured(handlers.dependencies.PasskeyRecoveryWebAuthn) {
		return writeAPIError(ctx, http.StatusBadRequest, "passkey_verification_failed")
	}
	parsedResponse, err := protocol.ParseCredentialRequestResponseBytes(body.Response)
	if err != nil || !constantTimePasskeyCredentialIDEqual(parsedResponse.RawID, credential.CredentialID) {
		return writeAPIError(ctx, http.StatusBadRequest, "passkey_verification_failed")
	}
	webAuthnConfiguration := handlers.dependencies.PasskeyRecoveryWebAuthn.Config
	if err := parsedResponse.Verify(
		challenge, webAuthnConfiguration.RPID, "", webAuthnConfiguration.RPOrigins,
		webAuthnConfiguration.RPOpaqueOrigins, webAuthnConfiguration.RPTopOrigins,
		webAuthnConfiguration.RPTopOriginVerificationMode, webAuthnConfiguration.RPAllowCrossOrigin,
		true, true, credential.PublicKey, webAuthnConfiguration.Signature,
	); err != nil {
		return writeAPIError(ctx, http.StatusBadRequest, "passkey_verification_failed")
	}
	newCounter := int64(parsedResponse.Response.AuthenticatorData.Counter)
	if (newCounter > 0 || credential.Counter > 0) && newCounter <= credential.Counter {
		return writeAPIError(ctx, http.StatusBadRequest, "passkey_verification_failed")
	}
	updated, err := handlers.dependencies.PasskeyRecovery.UpdateCounter(ctx.Request().Context(), user.ID, credential.CredentialID, credential.Counter, newCounter)
	if err != nil || !updated {
		return writeAPIError(ctx, http.StatusBadRequest, "passkey_verification_failed")
	}
	return ctx.JSON(http.StatusOK, map[string]string{"encryptedRecoveryPackage": base64.StdEncoding.EncodeToString(credential.EncryptedRecoveryPackage)})
}

func (handlers *Handlers) passkeyRecoveryStatus(ctx *echo.Context) error {
	user, authorized, err := handlers.authorizeApplicationRequest(ctx, "")
	if err != nil || !authorized {
		return err
	}
	if handlers.dependencies.PasskeyRecovery == nil {
		return errors.New("passkey recovery repository is unavailable")
	}
	credential, err := handlers.dependencies.PasskeyRecovery.GetCredential(ctx.Request().Context(), user.ID)
	if err != nil {
		return err
	}
	if credential != nil {
		defer credential.Clear()
	}
	return ctx.JSON(http.StatusOK, map[string]bool{"enrolled": credential != nil})
}

func (handlers *Handlers) passkeyRecoveryRemove(ctx *echo.Context) error {
	user, authorized, err := handlers.authorizeApplicationRequest(ctx, "recovery_mutation")
	if err != nil || !authorized {
		return err
	}
	if handlers.dependencies.PasskeyRecovery == nil {
		return errors.New("passkey recovery repository is unavailable")
	}
	if err := handlers.dependencies.PasskeyRecovery.RemoveCredential(ctx.Request().Context(), user.ID); err != nil {
		return err
	}
	return ctx.NoContent(http.StatusNoContent)
}

func passkeyRecoveryRegistrationExtensions(response []byte) (bool, bool) {
	fields, ok := rawJSONObject(response)
	if !ok {
		return false, false
	}
	clientExtensions, exists, unique := rawJSONField(fields, "clientExtensionResults")
	if !unique {
		return false, false
	}
	if !exists || bytes.Equal(bytes.TrimSpace(clientExtensions), []byte("null")) {
		return false, true
	}
	clientFields, ok := rawJSONObject(clientExtensions)
	if !ok {
		return false, false
	}
	if len(clientFields) == 0 {
		return false, true
	}
	prfRaw, exists, unique := rawJSONField(clientFields, "prf")
	if !unique {
		return false, false
	}
	e2eRaw, e2eExists, e2eUnique := rawJSONField(clientFields, "browserE2eTest")
	if !e2eUnique || e2eExists && !passkeyRecoveryJSONBoolean(e2eRaw, true) {
		return false, false
	}
	for name := range clientFields {
		if !strings.EqualFold(name, "prf") && !strings.EqualFold(name, "browserE2eTest") {
			return false, false
		}
	}
	if !exists {
		return false, true
	}
	if bytes.Equal(bytes.TrimSpace(prfRaw), []byte("null")) {
		return false, true
	}
	prfFields, ok := rawJSONObject(prfRaw)
	if !ok {
		return false, false
	}
	enabledRaw, exists, unique := rawJSONField(prfFields, "enabled")
	if !unique {
		return false, false
	}
	for name := range prfFields {
		if !strings.EqualFold(name, "enabled") {
			return false, false
		}
	}
	if !exists {
		return false, true
	}
	var enabled bool
	if err := json.Unmarshal(enabledRaw, &enabled); err != nil {
		return false, false
	}
	return enabled, true
}

func passkeyRecoveryAuthenticationExtensionsSafe(response []byte) bool {
	fields, ok := rawJSONObject(response)
	if !ok {
		return false
	}
	clientExtensions, exists, unique := rawJSONField(fields, "clientExtensionResults")
	if !unique {
		return false
	}
	if !exists || bytes.Equal(bytes.TrimSpace(clientExtensions), []byte("null")) {
		return true
	}
	clientFields, ok := rawJSONObject(clientExtensions)
	if !ok || len(clientFields) == 0 {
		return ok
	}
	e2e, exists, unique := rawJSONField(clientFields, "browserE2eTest")
	if !exists || !unique || len(clientFields) != 1 || !passkeyRecoveryJSONBoolean(e2e, true) {
		return false
	}
	for name := range clientFields {
		if !strings.EqualFold(name, "browserE2eTest") {
			return false
		}
	}
	return true
}

func rawJSONField(fields map[string]json.RawMessage, name string) (json.RawMessage, bool, bool) {
	var value json.RawMessage
	found := false
	for key, candidate := range fields {
		if !strings.EqualFold(key, name) {
			continue
		}
		if key != name || found {
			return nil, false, false
		}
		value = candidate
		found = true
	}
	return value, found, true
}

func rawJSONObject(raw []byte) (map[string]json.RawMessage, bool) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return nil, false
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(trimmed, &fields); err != nil || fields == nil {
		return nil, false
	}
	return fields, true
}

func passkeyRecoveryCredentialParameters() []protocol.CredentialParameter {
	parameters := webauthn.CredentialParametersRecommendedL3()
	return append([]protocol.CredentialParameter{{
		Type: protocol.PublicKeyCredentialType, Algorithm: webauthncose.AlgMLDSA44,
	}}, parameters...)
}

func passkeyRecoveryJSONBoolean(raw []byte, expected bool) bool {
	var value bool
	return json.Unmarshal(raw, &value) == nil && value == expected
}

func passkeyRecoveryWebAuthnConfigured(webAuthn *webauthn.WebAuthn) bool {
	return webAuthn != nil && webAuthn.Config != nil && webAuthn.Config.RPID != "" && len(webAuthn.Config.RPOrigins) > 0
}

func constantTimePasskeyCredentialIDEqual(left []byte, right []byte) bool {
	return len(left) == len(right) && subtle.ConstantTimeCompare(left, right) == 1
}

var _ webauthn.User = passkeyRecoveryWebAuthnUser{}
