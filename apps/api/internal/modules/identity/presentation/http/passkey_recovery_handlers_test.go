package http

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/protocol/webauthncbor"
	"github.com/go-webauthn/webauthn/protocol/webauthncose"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity/application"
	identityinfra "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity/infrastructure"
)

type passkeyRecoveryRepositoryStub struct {
	credential          *application.PasskeyRecoveryCredential
	challenge           string
	challengePurpose    application.PasskeyRecoveryPurpose
	issueErr            error
	consumeErr          error
	getErr              error
	saveErr             error
	counterErr          error
	removeErr           error
	issueCalls          int
	consumeCalls        int
	getCalls            int
	saveCalls           int
	counterCalls        int
	removeCalls         int
	issuedPurpose       application.PasskeyRecoveryPurpose
	consumedPurpose     application.PasskeyRecoveryPurpose
	savedUserID         string
	savedInput          application.PasskeyRecoveryRegistration
	persisted           *application.PasskeyRecoveryRegistration
	updatedUserID       string
	updatedCredentialID []byte
	updatedFrom         int64
	updatedTo           int64
	updated             bool
}

func (repository *passkeyRecoveryRepositoryStub) IssueChallenge(_ context.Context, _ string, purpose application.PasskeyRecoveryPurpose, challenge string) error {
	repository.issueCalls++
	repository.issuedPurpose = purpose
	repository.challengePurpose = purpose
	repository.challenge = challenge
	return repository.issueErr
}

func (repository *passkeyRecoveryRepositoryStub) ConsumeChallenge(_ context.Context, _ string, purpose application.PasskeyRecoveryPurpose) (string, error) {
	repository.consumeCalls++
	repository.consumedPurpose = purpose
	if repository.consumeErr != nil {
		return "", repository.consumeErr
	}
	if purpose != repository.challengePurpose {
		return "", nil
	}
	challenge := repository.challenge
	repository.challenge = ""
	return challenge, nil
}

func (repository *passkeyRecoveryRepositoryStub) GetCredential(_ context.Context, _ string) (*application.PasskeyRecoveryCredential, error) {
	repository.getCalls++
	if repository.getErr != nil || repository.credential == nil {
		return nil, repository.getErr
	}
	credential := *repository.credential
	credential.CredentialID = append([]byte(nil), credential.CredentialID...)
	credential.PublicKey = append([]byte(nil), credential.PublicKey...)
	credential.Transports = append([]string(nil), credential.Transports...)
	credential.EncryptedRecoveryPackage = append([]byte(nil), credential.EncryptedRecoveryPackage...)
	return &credential, nil
}

func (repository *passkeyRecoveryRepositoryStub) SaveCredential(_ context.Context, userID string, registration application.PasskeyRecoveryRegistration) error {
	repository.saveCalls++
	repository.savedUserID = userID
	repository.savedInput = registration
	if repository.saveErr != nil {
		return repository.saveErr
	}
	persisted := registration
	persisted.CredentialID = append([]byte(nil), registration.CredentialID...)
	persisted.PublicKey = append([]byte(nil), registration.PublicKey...)
	persisted.Transports = append([]string(nil), registration.Transports...)
	persisted.EncryptedRecoveryPackage = append([]byte(nil), registration.EncryptedRecoveryPackage...)
	repository.persisted = &persisted
	repository.credential = &application.PasskeyRecoveryCredential{
		CredentialID: append([]byte(nil), registration.CredentialID...),
		PublicKey:    append([]byte(nil), registration.PublicKey...), Counter: registration.Counter,
		Transports:               append([]string(nil), registration.Transports...),
		EncryptedRecoveryPackage: append([]byte(nil), registration.EncryptedRecoveryPackage...),
	}
	return nil
}

func (repository *passkeyRecoveryRepositoryStub) UpdateCounter(_ context.Context, userID string, credentialID []byte, expectedCounter int64, counter int64) (bool, error) {
	repository.counterCalls++
	repository.updatedUserID = userID
	repository.updatedCredentialID = append([]byte(nil), credentialID...)
	repository.updatedFrom = expectedCounter
	repository.updatedTo = counter
	if repository.counterErr != nil {
		return false, repository.counterErr
	}
	if repository.credential == nil || repository.credential.Counter != expectedCounter || string(repository.credential.CredentialID) != string(credentialID) {
		return false, nil
	}
	if !repository.updated {
		return false, nil
	}
	repository.credential.Counter = counter
	return true, nil
}

func (repository *passkeyRecoveryRepositoryStub) RemoveCredential(_ context.Context, _ string) error {
	repository.removeCalls++
	if repository.removeErr != nil {
		return repository.removeErr
	}
	repository.credential = nil
	repository.challenge = ""
	return nil
}

func authenticatedPasskeyRecoveryDependencies(repository *passkeyRecoveryRepositoryStub) (Dependencies, *cryptoProfileRateLimiter, *fakeSessionVerifier) {
	dependencies, limiter, verifier := authenticatedCryptoProfileDependencies(&cryptoProfileServiceStub{})
	configuration, err := identityinfra.ReadPasskeyRecoveryConfiguration("web.example.test", "https://web.example.test")
	if err != nil {
		panic(err)
	}
	webAuthn, err := identityinfra.NewPasskeyRecoveryWebAuthn(configuration)
	if err != nil {
		panic(err)
	}
	dependencies.PasskeyRecovery = repository
	dependencies.PasskeyRecoveryWebAuthn = webAuthn
	return dependencies, limiter, verifier
}

func invokePasskeyRecoveryHandler(t *testing.T, handler httpapi.OperationHandler, method string, path string, body string) *httptest.ResponseRecorder {
	t.Helper()
	return invokeHandler(t, handler, method, path, body, requestHeaders(testWebOrigin), true)
}

func TestPasskeyRecoveryRegistrationOptionsRequirePRFAndExcludeCurrentCredential(t *testing.T) {
	repository := &passkeyRecoveryRepositoryStub{credential: &application.PasskeyRecoveryCredential{
		CredentialID: []byte{1, 2, 3, 4, 5}, PublicKey: []byte{6}, Counter: 3,
		Transports: []string{"internal"}, EncryptedRecoveryPackage: syntheticPasskeyPackage(15),
	}}
	dependencies, limiter, verifier := authenticatedPasskeyRecoveryDependencies(repository)
	handler := NewHandlers(dependencies).OperationHandlers()["postPasskeyrecoveryRegistrationOptions"]
	response := invokePasskeyRecoveryHandler(t, handler, http.MethodPost, "/v1/passkey-recovery/registration/options", "")
	if response.Code != http.StatusOK {
		t.Fatalf("registration options response=%d %s", response.Code, response.Body.String())
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode registration options: %v", err)
	}
	if _, wrapped := payload["publicKey"]; wrapped {
		t.Fatal("registration options unexpectedly use a wrapper incompatible with the browser API")
	}
	var credentialParameters []protocol.CredentialParameter
	if err := json.Unmarshal(payload["pubKeyCredParams"], &credentialParameters); err != nil || len(credentialParameters) != 4 ||
		credentialParameters[0].Algorithm != webauthncose.AlgMLDSA44 || credentialParameters[1].Algorithm != webauthncose.AlgEdDSA ||
		credentialParameters[2].Algorithm != webauthncose.AlgES256 || credentialParameters[3].Algorithm != webauthncose.AlgRS256 {
		t.Fatalf("registration algorithm order differs from the historical API default: %#v (%v)", credentialParameters, err)
	}
	var extensions map[string]json.RawMessage
	if err := json.Unmarshal(payload["extensions"], &extensions); err != nil || string(extensions[protocol.ExtensionPRF]) != "{}" ||
		string(extensions[protocol.ExtensionCredProps]) != "true" {
		t.Fatalf("registration options did not request the PRF and credential-properties extensions: %#v (%v)", extensions, err)
	}
	var timeout int
	if err := json.Unmarshal(payload["timeout"], &timeout); err != nil || timeout != 60_000 {
		t.Fatalf("registration timeout=%d (%v); want the historical API default", timeout, err)
	}
	var user protocol.UserEntity
	if err := json.Unmarshal(payload["user"], &user); err != nil || user.DisplayName != "" {
		t.Fatalf("registration display name=%q (%v); want the historical API default", user.DisplayName, err)
	}
	assertEmptyWebAuthnHints(t, payload)
	var exclude []protocol.CredentialDescriptor
	if err := json.Unmarshal(payload["excludeCredentials"], &exclude); err != nil || len(exclude) != 1 ||
		string(exclude[0].CredentialID) != string(repository.credential.CredentialID) || len(exclude[0].Transport) != 0 {
		t.Fatalf("unexpected exclusion list: %#v (%v)", exclude, err)
	}
	var selection protocol.AuthenticatorSelection
	if err := json.Unmarshal(payload["authenticatorSelection"], &selection); err != nil ||
		selection.ResidentKey != protocol.ResidentKeyRequirementRequired || selection.UserVerification != protocol.VerificationRequired ||
		selection.RequireResidentKey == nil || !*selection.RequireResidentKey {
		t.Fatalf("unexpected authenticator selection: %#v (%v)", selection, err)
	}
	if repository.issueCalls != 1 || repository.issuedPurpose != application.PasskeyRecoveryRegistrationPurpose ||
		len(repository.challenge) < 22 || limiter.calls != 1 || limiter.operation != "recovery_mutation" ||
		verifier.minimum != application.AssuranceFreshProvider {
		t.Fatalf("registration options failed to issue a fresh-user challenge: repository=%#v limiter=%#v assurance=%q", repository, limiter, verifier.minimum)
	}
}

func TestPasskeyRecoveryRegistrationOptionsMatchHistoricalDefaultsWithoutCredential(t *testing.T) {
	repository := &passkeyRecoveryRepositoryStub{}
	dependencies, _, _ := authenticatedPasskeyRecoveryDependencies(repository)
	handler := NewHandlers(dependencies).OperationHandlers()["postPasskeyrecoveryRegistrationOptions"]
	response := invokePasskeyRecoveryHandler(t, handler, http.MethodPost, "/v1/passkey-recovery/registration/options", "")
	if response.Code != http.StatusOK {
		t.Fatalf("registration options response=%d %s", response.Code, response.Body.String())
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode registration options: %v", err)
	}
	var exclude []protocol.CredentialDescriptor
	if err := json.Unmarshal(payload["excludeCredentials"], &exclude); err != nil || exclude == nil || len(exclude) != 0 {
		t.Fatalf("registration exclusion list=%#v (%v); want an empty array", exclude, err)
	}
	var extensions map[string]json.RawMessage
	if err := json.Unmarshal(payload["extensions"], &extensions); err != nil || string(extensions[protocol.ExtensionPRF]) != "{}" ||
		string(extensions[protocol.ExtensionCredProps]) != "true" {
		t.Fatalf("registration extensions=%#v (%v)", extensions, err)
	}
	assertEmptyWebAuthnHints(t, payload)
}

func assertEmptyWebAuthnHints(t *testing.T, payload map[string]json.RawMessage) {
	t.Helper()
	var hints []protocol.PublicKeyCredentialHints
	if err := json.Unmarshal(payload["hints"], &hints); err != nil || hints == nil || len(hints) != 0 {
		t.Fatalf("registration hints=%#v (%v); want an empty array", hints, err)
	}
}

func TestPasskeyRecoveryAuthenticationOptionsReturnOnlyCredentialIDAndOpaquePackage(t *testing.T) {
	credentialID := []byte{1, 2, 3, 4, 5}
	packageBytes := syntheticPasskeyPackage(20)
	repository := &passkeyRecoveryRepositoryStub{credential: &application.PasskeyRecoveryCredential{
		CredentialID: credentialID, PublicKey: []byte{6}, Counter: 3,
		Transports: []string{"internal"}, EncryptedRecoveryPackage: packageBytes,
	}}
	dependencies, limiter, verifier := authenticatedPasskeyRecoveryDependencies(repository)
	handler := NewHandlers(dependencies).OperationHandlers()["postPasskeyrecoveryAuthenticationOptions"]
	response := invokePasskeyRecoveryHandler(t, handler, http.MethodPost, "/v1/passkey-recovery/authentication/options", "")
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("authentication options response=%d headers=%v body=%s", response.Code, response.Header(), response.Body.String())
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode authentication options: %v", err)
	}
	if _, wrapped := payload["publicKey"]; wrapped {
		t.Fatal("authentication options unexpectedly use a wrapper incompatible with the browser API")
	}
	var timeout int
	if err := json.Unmarshal(payload["timeout"], &timeout); err != nil || timeout != 60_000 {
		t.Fatalf("authentication timeout=%d (%v); want the historical API default", timeout, err)
	}
	var allow []protocol.CredentialDescriptor
	if err := json.Unmarshal(payload["allowCredentials"], &allow); err != nil || len(allow) != 1 ||
		string(allow[0].CredentialID) != string(credentialID) || len(allow[0].Transport) != 0 {
		t.Fatalf("unexpected allowed credential list: %#v (%v)", allow, err)
	}
	var encryptedPackage string
	if err := json.Unmarshal(payload["encryptedRecoveryPackage"], &encryptedPackage); err != nil || encryptedPackage != base64.StdEncoding.EncodeToString(packageBytes) {
		t.Fatalf("authentication options recovery package=%q (%v)", encryptedPackage, err)
	}
	var userVerification string
	if err := json.Unmarshal(payload["userVerification"], &userVerification); err != nil || userVerification != "required" {
		t.Fatalf("userVerification=%q (%v); want required", userVerification, err)
	}
	if repository.issueCalls != 1 || repository.issuedPurpose != application.PasskeyRecoveryAuthenticationPurpose ||
		limiter.calls != 1 || limiter.operation != "recovery_authentication" || verifier.minimum != application.AssuranceFreshProvider {
		t.Fatalf("authentication options authorization/challenge mismatch: repository=%#v limiter=%#v assurance=%q", repository, limiter, verifier.minimum)
	}
}

func TestPasskeyRecoveryStatusAndRemovalExposeNoCredentialMaterial(t *testing.T) {
	repository := &passkeyRecoveryRepositoryStub{credential: &application.PasskeyRecoveryCredential{
		CredentialID: []byte{1, 2, 3, 4}, PublicKey: []byte{5}, Counter: 0,
		EncryptedRecoveryPackage: syntheticPasskeyPackage(14),
	}}
	dependencies, limiter, verifier := authenticatedPasskeyRecoveryDependencies(repository)
	handlers := NewHandlers(dependencies).OperationHandlers()
	status := invokePasskeyRecoveryHandler(t, handlers["getPasskeyrecoveryStatus"], http.MethodGet, "/v1/passkey-recovery/status", "")
	if status.Code != http.StatusOK || status.Body.String() != "{\"enrolled\":true}\n" {
		t.Fatalf("status response=%d %q", status.Code, status.Body.String())
	}
	for _, field := range []string{"credentialId", "publicKey", "counter", "encryptedRecoveryPackage"} {
		if strings.Contains(status.Body.String(), field) {
			t.Fatalf("status response leaked credential field %q: %s", field, status.Body.String())
		}
	}
	if limiter.calls != 0 || verifier.minimum != application.AssuranceFreshProvider {
		t.Fatalf("status reader used a mutation limiter or wrong assurance: limiter=%#v assurance=%q", limiter, verifier.minimum)
	}

	removed := invokePasskeyRecoveryHandler(t, handlers["deletePasskeyrecovery"], http.MethodDelete, "/v1/passkey-recovery", "")
	if removed.Code != http.StatusNoContent || removed.Body.Len() != 0 || repository.removeCalls != 1 ||
		limiter.calls != 1 || limiter.operation != "recovery_mutation" {
		t.Fatalf("remove response=%d %q repository=%#v limiter=%#v", removed.Code, removed.Body.String(), repository, limiter)
	}
}

func TestPasskeyRecoveryRegistrationVerificationGatesE2EAndClearsInputs(t *testing.T) {
	credentialID := []byte{1, 2, 3, 4, 5}
	responseJSON := `{"id":"` + base64.RawURLEncoding.EncodeToString(credentialID) + `","type":"public-key","clientExtensionResults":{"browserE2eTest":true,"prf":{"enabled":true}}}`
	packageBytes := syntheticPasskeyPackage(16)
	body := `{"response":` + responseJSON + `,"encryptedRecoveryPackage":"` + base64.StdEncoding.EncodeToString(packageBytes) + `"}`
	repository := &passkeyRecoveryRepositoryStub{challenge: passkeyTestChallenge(), challengePurpose: application.PasskeyRecoveryRegistrationPurpose}
	dependencies, limiter, verifier := authenticatedPasskeyRecoveryDependencies(repository)
	dependencies.NodeEnvironment = "development"
	dependencies.E2EBrowserTests = "1"
	handler := NewHandlers(dependencies).OperationHandlers()["postPasskeyrecoveryRegistrationVerify"]
	requestBody := body
	response := invokePasskeyRecoveryHandler(t, handler, http.MethodPost, "/v1/passkey-recovery/registration/verify", requestBody)
	if response.Code != http.StatusNoContent || response.Body.Len() != 0 {
		t.Fatalf("registration verification response=%d %q", response.Code, response.Body.String())
	}
	if repository.consumeCalls != 1 || repository.consumedPurpose != application.PasskeyRecoveryRegistrationPurpose ||
		repository.saveCalls != 1 || repository.savedUserID != "synthetic-user" || repository.persisted == nil ||
		string(repository.persisted.CredentialID) != string(credentialID) || string(repository.persisted.PublicKey) != string([]byte{1, 2, 3, 4}) ||
		repository.persisted.Counter != 0 || len(repository.persisted.Transports) != 1 || repository.persisted.Transports[0] != "internal" ||
		string(repository.persisted.EncryptedRecoveryPackage) != string(packageBytes) {
		t.Fatalf("E2E registration persistence mismatch: %#v", repository)
	}
	if !allZeroBytes(repository.savedInput.CredentialID) || !allZeroBytes(repository.savedInput.PublicKey) ||
		!allZeroBytes(repository.savedInput.EncryptedRecoveryPackage) || !allZeroStrings(repository.savedInput.Transports) {
		t.Fatal("registration inputs were not cleared after repository save")
	}
	if limiter.calls != 1 || limiter.operation != "recovery_mutation" || verifier.minimum != application.AssuranceFreshProvider {
		t.Fatalf("registration verification authorization mismatch: limiter=%#v assurance=%q", limiter, verifier.minimum)
	}
}

func TestPasskeyRecoveryRealRegistrationAndAuthenticationCeremonies(t *testing.T) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate synthetic authenticator key: %v", err)
	}
	defer key.D.SetInt64(0)

	credentialID := []byte("synthetic-passkey-credential-id")
	recoveryPackage := syntheticPasskeyPackage(16)
	repository := &passkeyRecoveryRepositoryStub{updated: true}
	dependencies, limiter, verifier := authenticatedPasskeyRecoveryDependencies(repository)
	dependencies.NodeEnvironment = "production"
	dependencies.E2EBrowserTests = "1"
	handlers := NewHandlers(dependencies).OperationHandlers()

	registrationOptions := invokePasskeyRecoveryHandler(
		t,
		handlers["postPasskeyrecoveryRegistrationOptions"],
		http.MethodPost,
		"/v1/passkey-recovery/registration/options",
		"",
	)
	if registrationOptions.Code != http.StatusOK || repository.challenge == "" {
		t.Fatalf("registration options response=%d body=%s", registrationOptions.Code, registrationOptions.Body.String())
	}
	registrationChallenge := repository.challenge
	registrationClientData := passkeyTestClientData(t, protocol.CreateCeremony, registrationChallenge, "https://web.example.test")
	credentialPublicKey := passkeyTestCOSEPublicKey(t, key)
	attestedCredentialData := make([]byte, 0, 16+2+len(credentialID)+len(credentialPublicKey))
	attestedCredentialData = append(attestedCredentialData, []byte("synthetic-aaguid")...)
	credentialLength := make([]byte, 2)
	binary.BigEndian.PutUint16(credentialLength, uint16(len(credentialID)))
	attestedCredentialData = append(attestedCredentialData, credentialLength...)
	attestedCredentialData = append(attestedCredentialData, credentialID...)
	attestedCredentialData = append(attestedCredentialData, credentialPublicKey...)
	registrationAuthenticatorData := passkeyTestAuthenticatorData(
		"web.example.test",
		protocol.FlagUserPresent|protocol.FlagUserVerified|protocol.FlagAttestedCredentialData,
		0,
		attestedCredentialData,
	)
	registrationSignature := passkeyTestSignature(t, key, registrationAuthenticatorData, registrationClientData)
	attestationObject, err := webauthncbor.Marshal(map[string]any{
		"fmt":      "packed",
		"authData": registrationAuthenticatorData,
		"attStmt": map[string]any{
			"alg": int64(webauthncose.AlgES256),
			"sig": registrationSignature,
		},
	})
	if err != nil {
		t.Fatalf("marshal synthetic packed attestation: %v", err)
	}
	credentialIDEncoded := base64.RawURLEncoding.EncodeToString(credentialID)
	registrationBody, err := json.Marshal(map[string]any{
		"response": map[string]any{
			"id":    credentialIDEncoded,
			"rawId": credentialIDEncoded,
			"type":  "public-key",
			"response": map[string]string{
				"clientDataJSON":    base64.RawURLEncoding.EncodeToString(registrationClientData),
				"attestationObject": base64.RawURLEncoding.EncodeToString(attestationObject),
			},
			"clientExtensionResults": map[string]any{"prf": map[string]any{"enabled": true}},
		},
		"encryptedRecoveryPackage": base64.StdEncoding.EncodeToString(recoveryPackage),
	})
	if err != nil {
		t.Fatalf("marshal synthetic registration response: %v", err)
	}
	registrationVerify := invokePasskeyRecoveryHandler(
		t,
		handlers["postPasskeyrecoveryRegistrationVerify"],
		http.MethodPost,
		"/v1/passkey-recovery/registration/verify",
		string(registrationBody),
	)
	if registrationVerify.Code != http.StatusNoContent || registrationVerify.Body.Len() != 0 {
		t.Fatalf("real registration response=%d body=%s", registrationVerify.Code, registrationVerify.Body.String())
	}
	if repository.persisted == nil ||
		string(repository.persisted.CredentialID) != string(credentialID) ||
		len(repository.persisted.PublicKey) == 0 ||
		repository.persisted.Counter != 0 ||
		string(repository.persisted.EncryptedRecoveryPackage) != string(recoveryPackage) {
		t.Fatalf("real registration did not persist the synthetic credential/package: %#v", repository.persisted)
	}

	authenticationOptions := invokePasskeyRecoveryHandler(
		t,
		handlers["postPasskeyrecoveryAuthenticationOptions"],
		http.MethodPost,
		"/v1/passkey-recovery/authentication/options",
		"",
	)
	if authenticationOptions.Code != http.StatusOK || repository.challenge == "" {
		t.Fatalf("authentication options response=%d body=%s", authenticationOptions.Code, authenticationOptions.Body.String())
	}
	authenticationClientData := passkeyTestClientData(t, protocol.AssertCeremony, repository.challenge, "https://web.example.test")
	authenticationAuthenticatorData := passkeyTestAuthenticatorData(
		"web.example.test",
		protocol.FlagUserPresent|protocol.FlagUserVerified,
		1,
		nil,
	)
	authenticationSignature := passkeyTestSignature(t, key, authenticationAuthenticatorData, authenticationClientData)
	authenticationBody, err := json.Marshal(map[string]any{
		"response": map[string]any{
			"id":    credentialIDEncoded,
			"rawId": credentialIDEncoded,
			"type":  "public-key",
			"response": map[string]string{
				"authenticatorData": base64.RawURLEncoding.EncodeToString(authenticationAuthenticatorData),
				"clientDataJSON":    base64.RawURLEncoding.EncodeToString(authenticationClientData),
				"signature":         base64.RawURLEncoding.EncodeToString(authenticationSignature),
			},
			"clientExtensionResults": map[string]any{},
		},
	})
	if err != nil {
		t.Fatalf("marshal synthetic assertion response: %v", err)
	}
	authenticationVerify := invokePasskeyRecoveryHandler(
		t,
		handlers["postPasskeyrecoveryAuthenticationVerify"],
		http.MethodPost,
		"/v1/passkey-recovery/authentication/verify",
		string(authenticationBody),
	)
	var authenticationPayload map[string]string
	if err := json.Unmarshal(authenticationVerify.Body.Bytes(), &authenticationPayload); err != nil ||
		authenticationVerify.Code != http.StatusOK ||
		authenticationPayload["encryptedRecoveryPackage"] != base64.StdEncoding.EncodeToString(recoveryPackage) {
		t.Fatalf("real authentication response=%d body=%s decode error=%v", authenticationVerify.Code, authenticationVerify.Body.String(), err)
	}
	if repository.issueCalls != 2 || repository.consumeCalls != 2 ||
		repository.consumedPurpose != application.PasskeyRecoveryAuthenticationPurpose ||
		repository.counterCalls != 1 || repository.updatedFrom != 0 || repository.updatedTo != 1 ||
		repository.credential == nil || repository.credential.Counter != 1 ||
		limiter.calls != 4 || verifier.minimum != application.AssuranceFreshProvider {
		t.Fatalf("real WebAuthn ceremony lifecycle mismatch: repository=%#v limiter=%#v assurance=%q", repository, limiter, verifier.minimum)
	}
}

func TestPasskeyRecoveryRegistrationRejectsPRFResultsAndExpiredChallenge(t *testing.T) {
	credentialID := []byte{1, 2, 3, 4}
	packageBytes := base64.StdEncoding.EncodeToString(syntheticPasskeyPackage(13))
	body := `{"response":{"id":"` + base64.RawURLEncoding.EncodeToString(credentialID) + `","type":"public-key","clientExtensionResults":{"prf":{"enabled":true,"results":{"first":"synthetic-prf-output"}}}},"encryptedRecoveryPackage":"` + packageBytes + `"}`
	repository := &passkeyRecoveryRepositoryStub{challenge: passkeyTestChallenge(), challengePurpose: application.PasskeyRecoveryRegistrationPurpose}
	dependencies, _, _ := authenticatedPasskeyRecoveryDependencies(repository)
	dependencies.NodeEnvironment = "production"
	dependencies.E2EBrowserTests = "1"
	handler := NewHandlers(dependencies).OperationHandlers()["postPasskeyrecoveryRegistrationVerify"]
	response := invokePasskeyRecoveryHandler(t, handler, http.MethodPost, "/v1/passkey-recovery/registration/verify", body)
	if response.Code != http.StatusBadRequest || response.Body.String() != "{\"error\":\"passkey_verification_failed\"}\n" || repository.saveCalls != 0 {
		t.Fatalf("PRF result was accepted or leaked: response=%d %q repository=%#v", response.Code, response.Body.String(), repository)
	}
	if strings.Contains(response.Body.String(), "synthetic-prf-output") {
		t.Fatal("PRF extension output leaked in the error response")
	}

	repository = &passkeyRecoveryRepositoryStub{challengePurpose: application.PasskeyRecoveryRegistrationPurpose}
	dependencies, _, _ = authenticatedPasskeyRecoveryDependencies(repository)
	handler = NewHandlers(dependencies).OperationHandlers()["postPasskeyrecoveryRegistrationVerify"]
	response = invokePasskeyRecoveryHandler(t, handler, http.MethodPost, "/v1/passkey-recovery/registration/verify", `{"response":{},"encryptedRecoveryPackage":"`+packageBytes+`"}`)
	if response.Code != http.StatusBadRequest || response.Body.String() != "{\"error\":\"passkey_challenge_expired\"}\n" || repository.consumeCalls != 1 || repository.saveCalls != 0 {
		t.Fatalf("expired registration challenge response=%d %q repository=%#v", response.Code, response.Body.String(), repository)
	}
}

func TestPasskeyRecoveryRegistrationRejectsPRFOutputEvenOnE2EPath(t *testing.T) {
	credentialID := []byte{1, 2, 3, 4}
	packageBytes := base64.StdEncoding.EncodeToString(syntheticPasskeyPackage(13))
	body := `{"response":{"id":"` + base64.RawURLEncoding.EncodeToString(credentialID) + `","type":"public-key","clientExtensionResults":{"browserE2eTest":true,"prf":{"enabled":true,"results":{"first":"synthetic-prf-output"}}}},"encryptedRecoveryPackage":"` + packageBytes + `"}`
	repository := &passkeyRecoveryRepositoryStub{challenge: passkeyTestChallenge(), challengePurpose: application.PasskeyRecoveryRegistrationPurpose}
	dependencies, _, _ := authenticatedPasskeyRecoveryDependencies(repository)
	dependencies.NodeEnvironment = "development"
	dependencies.E2EBrowserTests = "1"
	handler := NewHandlers(dependencies).OperationHandlers()["postPasskeyrecoveryRegistrationVerify"]
	response := invokePasskeyRecoveryHandler(t, handler, http.MethodPost, "/v1/passkey-recovery/registration/verify", body)
	if response.Code != http.StatusBadRequest || response.Body.String() != "{\"error\":\"passkey_verification_failed\"}\n" || repository.saveCalls != 0 {
		t.Fatalf("E2E registration accepted or leaked PRF output: response=%d %q repository=%#v", response.Code, response.Body.String(), repository)
	}
}

func TestPasskeyRecoveryAuthenticationVerificationCASAndRejectsPRFOutput(t *testing.T) {
	credentialID := []byte{1, 2, 3, 4, 5}
	packageBytes := syntheticPasskeyPackage(17)
	repository := &passkeyRecoveryRepositoryStub{
		credential: &application.PasskeyRecoveryCredential{
			CredentialID: credentialID, PublicKey: []byte{6}, Counter: 8,
			Transports: []string{"internal"}, EncryptedRecoveryPackage: packageBytes,
		},
		challenge: passkeyTestChallenge(), challengePurpose: application.PasskeyRecoveryAuthenticationPurpose, updated: true,
	}
	dependencies, limiter, verifier := authenticatedPasskeyRecoveryDependencies(repository)
	dependencies.NodeEnvironment = "development"
	dependencies.E2EBrowserTests = "1"
	handler := NewHandlers(dependencies).OperationHandlers()["postPasskeyrecoveryAuthenticationVerify"]
	body := `{"response":{"id":"` + base64.RawURLEncoding.EncodeToString(credentialID) + `","type":"public-key","clientExtensionResults":{"browserE2eTest":true},"response":{}}}`
	response := invokePasskeyRecoveryHandler(t, handler, http.MethodPost, "/v1/passkey-recovery/authentication/verify", body)
	var payload map[string]string
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil || response.Code != http.StatusOK ||
		payload["encryptedRecoveryPackage"] != base64.StdEncoding.EncodeToString(packageBytes) {
		t.Fatalf("E2E authentication response=%d %q (%v)", response.Code, response.Body.String(), err)
	}
	if repository.counterCalls != 1 || repository.updatedUserID != "synthetic-user" || repository.updatedFrom != 8 || repository.updatedTo != 9 ||
		limiter.calls != 1 || limiter.operation != "recovery_authentication" || verifier.minimum != application.AssuranceFreshProvider {
		t.Fatalf("authentication counter/update authorization mismatch: repository=%#v limiter=%#v assurance=%q", repository, limiter, verifier.minimum)
	}

	repository = &passkeyRecoveryRepositoryStub{
		credential: &application.PasskeyRecoveryCredential{
			CredentialID: credentialID, PublicKey: []byte{6}, Counter: 8,
			EncryptedRecoveryPackage: packageBytes,
		},
		challenge: passkeyTestChallenge(), challengePurpose: application.PasskeyRecoveryAuthenticationPurpose,
	}
	dependencies, _, _ = authenticatedPasskeyRecoveryDependencies(repository)
	dependencies.NodeEnvironment = "development"
	dependencies.E2EBrowserTests = "1"
	handler = NewHandlers(dependencies).OperationHandlers()["postPasskeyrecoveryAuthenticationVerify"]
	leakedPRF := `{"response":{"id":"` + base64.RawURLEncoding.EncodeToString(credentialID) + `","type":"public-key","clientExtensionResults":{"browserE2eTest":true,"prf":{"results":{"first":"synthetic-prf-output"}}},"response":{}}}`
	response = invokePasskeyRecoveryHandler(t, handler, http.MethodPost, "/v1/passkey-recovery/authentication/verify", leakedPRF)
	if response.Code != http.StatusBadRequest || response.Body.String() != "{\"error\":\"passkey_verification_failed\"}\n" || repository.counterCalls != 0 ||
		strings.Contains(response.Body.String(), "synthetic-prf-output") {
		t.Fatalf("PRF result was accepted or leaked: response=%d %q repository=%#v", response.Code, response.Body.String(), repository)
	}
}

func TestPasskeyRecoveryAuthenticationVerificationRequiresCounterCAS(t *testing.T) {
	credentialID := []byte{1, 2, 3, 4}
	repository := &passkeyRecoveryRepositoryStub{
		credential: &application.PasskeyRecoveryCredential{
			CredentialID: credentialID, PublicKey: []byte{6}, Counter: 0,
			EncryptedRecoveryPackage: syntheticPasskeyPackage(13),
		},
		challenge: passkeyTestChallenge(), challengePurpose: application.PasskeyRecoveryAuthenticationPurpose,
	}
	dependencies, _, _ := authenticatedPasskeyRecoveryDependencies(repository)
	dependencies.NodeEnvironment = "development"
	dependencies.E2EBrowserTests = "1"
	handler := NewHandlers(dependencies).OperationHandlers()["postPasskeyrecoveryAuthenticationVerify"]
	body := `{"response":{"id":"` + base64.RawURLEncoding.EncodeToString(credentialID) + `","type":"public-key","clientExtensionResults":{"browserE2eTest":true},"response":{}}}`
	response := invokePasskeyRecoveryHandler(t, handler, http.MethodPost, "/v1/passkey-recovery/authentication/verify", body)
	if response.Code != http.StatusBadRequest || response.Body.String() != "{\"error\":\"passkey_verification_failed\"}\n" || repository.counterCalls != 1 {
		t.Fatalf("failed counter CAS response=%d %q repository=%#v", response.Code, response.Body.String(), repository)
	}
}

func TestPasskeyRecoveryAuthenticationRejectsMissingCredentialAndExtensionOutput(t *testing.T) {
	dependencies, _, _ := authenticatedPasskeyRecoveryDependencies(&passkeyRecoveryRepositoryStub{
		challenge: passkeyTestChallenge(), challengePurpose: application.PasskeyRecoveryAuthenticationPurpose,
	})
	dependencies.NodeEnvironment = "production"
	handler := NewHandlers(dependencies).OperationHandlers()["postPasskeyrecoveryAuthenticationVerify"]
	response := invokePasskeyRecoveryHandler(t, handler, http.MethodPost, "/v1/passkey-recovery/authentication/verify", `{"response":{}}`)
	if response.Code != http.StatusBadRequest || response.Body.String() != "{\"error\":\"passkey_challenge_expired\"}\n" {
		t.Fatalf("missing-credential response=%d %q", response.Code, response.Body.String())
	}

	validID := []byte{1, 2, 3, 4}
	repository := &passkeyRecoveryRepositoryStub{
		credential: &application.PasskeyRecoveryCredential{
			CredentialID: validID, PublicKey: []byte{6}, Counter: 0,
			EncryptedRecoveryPackage: syntheticPasskeyPackage(13),
		},
		challenge: passkeyTestChallenge(), challengePurpose: application.PasskeyRecoveryAuthenticationPurpose,
	}
	dependencies, _, _ = authenticatedPasskeyRecoveryDependencies(repository)
	dependencies.NodeEnvironment = "production"
	handler = NewHandlers(dependencies).OperationHandlers()["postPasskeyrecoveryAuthenticationVerify"]
	body := `{"response":{"id":"` + base64.RawURLEncoding.EncodeToString(validID) + `","type":"public-key","clientExtensionResults":{"hmacGetSecret":{"output1":"synthetic-secret"}},"response":{}}}`
	response = invokePasskeyRecoveryHandler(t, handler, http.MethodPost, "/v1/passkey-recovery/authentication/verify", body)
	if response.Code != http.StatusBadRequest || response.Body.String() != "{\"error\":\"passkey_verification_failed\"}\n" || repository.counterCalls != 0 {
		t.Fatalf("unsolicited extension output response=%d %q repository=%#v", response.Code, response.Body.String(), repository)
	}
}

func TestPasskeyRecoveryExtensionFiltersHandleCaseVariantsAndDuplicates(t *testing.T) {
	for _, raw := range [][]byte{
		[]byte(`{"clientExtensionResults":{"prf":{"results":{}}}}`),
		[]byte(`{"ClientExtensionResults":{"prf":{"results":{}}}}`),
		[]byte(`{"clientExtensionResults":{},"ClientExtensionResults":{"prf":{"results":{}}}}`),
	} {
		if passkeyRecoveryAuthenticationExtensionsSafe(raw) {
			t.Errorf("accepted non-empty or ambiguous client extension output %s", raw)
		}
	}
	if enabled, safe := passkeyRecoveryRegistrationExtensions([]byte(`{"clientExtensionResults":{"PRF":{"enabled":true,"results":{}}}}`)); safe || enabled {
		t.Fatal("accepted a PRF result or case-variant output that should remain client-only")
	}
	if enabled, safe := passkeyRecoveryRegistrationExtensions([]byte(`{"ClientExtensionResults":{"PRF":{"ENABLED":true}}}`)); safe || enabled {
		t.Fatal("accepted case-variant extension field names")
	}
	if enabled, safe := passkeyRecoveryRegistrationExtensions([]byte(`{"clientExtensionResults":{"browserE2eTest":true,"prf":{"enabled":true}}}`)); !safe || !enabled {
		t.Fatal("rejected the safe development E2E markers")
	}
	if !passkeyRecoveryAuthenticationExtensionsSafe([]byte(`{"clientExtensionResults":{"browserE2eTest":true}}`)) {
		t.Fatal("rejected the safe development E2E marker")
	}
	if passkeyRecoveryAuthenticationExtensionsSafe([]byte(`{"clientExtensionResults":{"browserE2eTest":true,"prf":{"results":{}}}}`)) {
		t.Fatal("accepted authentication extension output alongside the E2E marker")
	}
}

func allZeroStrings(values []string) bool {
	for _, value := range values {
		if value != "" {
			return false
		}
	}
	return true
}

func passkeyTestChallenge() string {
	return base64.RawURLEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
}

func passkeyTestClientData(t *testing.T, ceremony protocol.CeremonyType, challenge, origin string) []byte {
	t.Helper()
	clientData, err := json.Marshal(protocol.CollectedClientData{Type: ceremony, Challenge: challenge, Origin: origin})
	if err != nil {
		t.Fatalf("marshal synthetic WebAuthn client data: %v", err)
	}
	return clientData
}

func passkeyTestCOSEPublicKey(t *testing.T, key *ecdsa.PrivateKey) []byte {
	t.Helper()
	publicKey, err := webauthncbor.Marshal(map[int64]any{
		1:  int64(webauthncose.EllipticKey),
		3:  int64(webauthncose.AlgES256),
		-1: int64(webauthncose.P256),
		-2: key.X.FillBytes(make([]byte, 32)),
		-3: key.Y.FillBytes(make([]byte, 32)),
	})
	if err != nil {
		t.Fatalf("marshal synthetic COSE public key: %v", err)
	}
	return publicKey
}

func passkeyTestAuthenticatorData(rpID string, flags protocol.AuthenticatorFlags, counter uint32, trailingData []byte) []byte {
	rpIDHash := sha256.Sum256([]byte(rpID))
	authenticatorData := make([]byte, 0, len(rpIDHash)+1+4+len(trailingData))
	authenticatorData = append(authenticatorData, rpIDHash[:]...)
	authenticatorData = append(authenticatorData, byte(flags))
	counterBytes := make([]byte, 4)
	binary.BigEndian.PutUint32(counterBytes, counter)
	authenticatorData = append(authenticatorData, counterBytes...)
	return append(authenticatorData, trailingData...)
}

func passkeyTestSignature(t *testing.T, key *ecdsa.PrivateKey, authenticatorData, clientDataJSON []byte) []byte {
	t.Helper()
	clientDataHash := sha256.Sum256(clientDataJSON)
	signedData := make([]byte, 0, len(authenticatorData)+len(clientDataHash))
	signedData = append(signedData, authenticatorData...)
	signedData = append(signedData, clientDataHash[:]...)
	digest := sha256.Sum256(signedData)
	signature, err := ecdsa.SignASN1(rand.Reader, key, digest[:])
	if err != nil {
		t.Fatalf("sign synthetic WebAuthn data: %v", err)
	}
	return signature
}

func syntheticPasskeyPackage(length int) []byte {
	value := make([]byte, length)
	for index := range value {
		value[index] = byte(index + 1)
	}
	return value
}

var _ application.PasskeyRecoveryRepository = (*passkeyRecoveryRepositoryStub)(nil)
