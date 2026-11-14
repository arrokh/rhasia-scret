package http

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/service/identity"
)

type cryptoProfileUserProvisioner struct {
	user application.ApplicationUser
	err  error
}

func (provisioner cryptoProfileUserProvisioner) Provision(context.Context, application.Principal) (application.ApplicationUser, error) {
	return provisioner.user, provisioner.err
}

type cryptoProfileRateLimiter struct {
	decision  application.RateLimitDecision
	err       error
	userID    string
	operation string
	calls     int
}

func (limiter *cryptoProfileRateLimiter) Consume(_ context.Context, userID string, operation string) (application.RateLimitDecision, error) {
	limiter.calls++
	limiter.userID = userID
	limiter.operation = operation
	return limiter.decision, limiter.err
}

type cryptoProfileServiceStub struct {
	profile         *application.EncryptedUserCryptoProfile
	getErr          error
	getCalls        int
	rewrap          application.UserRootKeyRewrap
	rewrapErr       error
	rewrapCalls     int
	migration       application.UserCryptoProfileMigration
	migrationResult application.UserCryptoProfileMigrationResult
	migrationErr    error
	migrationCalls  int
}

func (service *cryptoProfileServiceStub) Get(context.Context, string) (*application.EncryptedUserCryptoProfile, error) {
	service.getCalls++
	return service.profile, service.getErr
}

func (service *cryptoProfileServiceStub) RewrapUserRootKey(_ context.Context, _ string, rewrap application.UserRootKeyRewrap) error {
	service.rewrapCalls++
	service.rewrap = application.UserRootKeyRewrap{
		VaultUnlockSalt:           append([]byte(nil), rewrap.VaultUnlockSalt...),
		WrappedUserRootKey:        append([]byte(nil), rewrap.WrappedUserRootKey...),
		EncryptedPersonalVaultKey: append([]byte(nil), rewrap.EncryptedPersonalVaultKey...),
		EncryptionVersion:         rewrap.EncryptionVersion,
	}
	return service.rewrapErr
}

func (service *cryptoProfileServiceStub) MigrateUserCryptoProfile(_ context.Context, _ string, migration application.UserCryptoProfileMigration) (application.UserCryptoProfileMigrationResult, error) {
	service.migrationCalls++
	service.migration = migration
	return service.migrationResult, service.migrationErr
}

func authenticatedCryptoProfileDependencies(service *cryptoProfileServiceStub) (Dependencies, *cryptoProfileRateLimiter, *fakeSessionVerifier) {
	dependencies := defaultDependencies()
	principal := &application.Principal{
		Issuer:        application.PasswordlessIssuer,
		Subject:       "synthetic-subject",
		Email:         "person@example.test",
		EmailVerified: true,
		Assurance:     application.AssuranceActiveSession,
	}
	verifier := &fakeSessionVerifier{principal: principal}
	limiter := &cryptoProfileRateLimiter{decision: application.RateLimitDecision{Allowed: true}}
	dependencies.Authenticator = application.Authenticator{
		Sessions:    verifier,
		Users:       cryptoProfileUserProvisioner{user: application.ApplicationUser{ID: "synthetic-user", Email: "person@example.test", Status: "ACTIVE"}},
		RateLimiter: limiter,
	}
	dependencies.CryptoProfiles = service
	return dependencies, limiter, verifier
}

func invokeProfileHandler(t *testing.T, handler httpapi.OperationHandler, method string, body string) *httptest.ResponseRecorder {
	t.Helper()
	return invokeHandler(t, handler, method, "/v1/user-crypto-profile", body, requestHeaders(testWebOrigin), true)
}

func TestGetUserCryptoProfileReturnsOnlyEncryptedProfileMaterial(t *testing.T) {
	profile := &application.EncryptedUserCryptoProfile{
		VaultUnlockSalt:           []byte{1, 2, 3},
		WrappedUserRootKey:        []byte{4, 5, 6},
		EncryptedPersonalVaultKey: []byte{7, 8, 9},
		EncryptionVersion:         1,
		UserEncryptionPublicKey:   json.RawMessage(`{"kty":"EC","crv":"P-256","x":"synthetic-x","y":"synthetic-y"}`),
		EncryptedUserPrivateKey:   []byte{10, 11, 12},
	}
	service := &cryptoProfileServiceStub{profile: profile}
	dependencies, limiter, verifier := authenticatedCryptoProfileDependencies(service)
	handler := NewHandlers(dependencies).OperationHandlers()["getUsercryptoprofile"]
	response := invokeProfileHandler(t, handler, http.MethodGet, "")
	if response.Code != http.StatusOK {
		t.Fatalf("GET profile status=%d body=%s", response.Code, response.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode profile response: %v", err)
	}
	for key, want := range map[string]string{
		"vaultUnlockSalt":           base64.StdEncoding.EncodeToString(profile.VaultUnlockSalt),
		"wrappedUserRootKey":        base64.StdEncoding.EncodeToString(profile.WrappedUserRootKey),
		"encryptedPersonalVaultKey": base64.StdEncoding.EncodeToString(profile.EncryptedPersonalVaultKey),
		"encryptedUserPrivateKey":   base64.StdEncoding.EncodeToString(profile.EncryptedUserPrivateKey),
	} {
		if payload[key] != want {
			t.Errorf("response %s=%v; want base64 encrypted material", key, payload[key])
		}
	}
	publicKey, ok := payload["userEncryptionPublicKey"].(map[string]any)
	if payload["encryptionVersion"] != float64(1) || !ok || publicKey["kty"] != "EC" {
		t.Fatalf("unexpected public profile fields: %#v", payload)
	}
	if _, found := payload["email"]; found || limiter.calls != 0 || verifier.minimum != application.AssuranceFreshProvider {
		t.Fatal("profile response leaked identity data or reader authorization consumed a mutation rate limit")
	}
}

func TestGetUserCryptoProfileMapsMissingProfileAndAuthentication(t *testing.T) {
	service := &cryptoProfileServiceStub{}
	dependencies, _, _ := authenticatedCryptoProfileDependencies(service)
	handler := NewHandlers(dependencies).OperationHandlers()["getUsercryptoprofile"]
	missing := invokeProfileHandler(t, handler, http.MethodGet, "")
	if missing.Code != http.StatusNotFound || missing.Body.String() != "{\"error\":\"not_initialized\"}\n" {
		t.Fatalf("missing profile response=%d %q", missing.Code, missing.Body.String())
	}
	service.getCalls = 0
	dependencies, _, _ = authenticatedCryptoProfileDependencies(service)
	dependencies.Authenticator.Sessions = &fakeSessionVerifier{}
	unauthenticated := invokeProfileHandler(t, NewHandlers(dependencies).OperationHandlers()["getUsercryptoprofile"], http.MethodGet, "")
	if unauthenticated.Code != http.StatusUnauthorized || service.getCalls != 0 {
		t.Fatalf("unauthenticated profile response=%d calls=%d", unauthenticated.Code, service.getCalls)
	}
}

func TestRewrapUserRootKeyValidatesAndAppliesMutationAuthentication(t *testing.T) {
	salt := make([]byte, 16)
	wrapped := make([]byte, 40)
	for i := range wrapped {
		wrapped[i] = byte(i + 1)
	}
	personalKey := make([]byte, 40)
	for i := range personalKey {
		personalKey[i] = byte(i + 41)
	}
	payload := map[string]any{
		"vaultUnlockSalt":           base64.StdEncoding.EncodeToString(salt),
		"wrappedUserRootKey":        base64.StdEncoding.EncodeToString(wrapped),
		"encryptedPersonalVaultKey": base64.StdEncoding.EncodeToString(personalKey),
		"encryptionVersion":         1,
	}
	body, _ := json.Marshal(payload)
	service := &cryptoProfileServiceStub{}
	dependencies, limiter, _ := authenticatedCryptoProfileDependencies(service)
	response := invokeProfileHandler(t, NewHandlers(dependencies).OperationHandlers()["postUsercryptoprofileRewrap"], http.MethodPost, string(body))
	if response.Code != http.StatusNoContent || response.Body.Len() != 0 {
		t.Fatalf("rewrap response=%d %q", response.Code, response.Body.String())
	}
	if limiter.calls != 1 || limiter.userID != "synthetic-user" || limiter.operation != "key_material_mutation" {
		t.Fatalf("rewrap authorization did not enforce the expected mutation limit: %#v", limiter)
	}
	if service.rewrapCalls != 1 || string(service.rewrap.VaultUnlockSalt) != string(salt) || string(service.rewrap.WrappedUserRootKey) != string(wrapped) || string(service.rewrap.EncryptedPersonalVaultKey) != string(personalKey) {
		t.Fatalf("rewrap operation mismatch: %#v", service.rewrap)
	}
}

func TestRewrapUserRootKeyRejectsInvalidOrNoncanonicalMaterial(t *testing.T) {
	service := &cryptoProfileServiceStub{}
	dependencies, _, _ := authenticatedCryptoProfileDependencies(service)
	handler := NewHandlers(dependencies).OperationHandlers()["postUsercryptoprofileRewrap"]
	validSalt := base64.StdEncoding.EncodeToString(make([]byte, 16))
	validWrapped := base64.StdEncoding.EncodeToString(make([]byte, 30))
	cases := []string{
		`{"vaultUnlockSalt":"` + validSalt + `","wrappedUserRootKey":"` + validWrapped + `","encryptionVersion":2}`,
		`{"vaultUnlockSalt":"` + validSalt + `","wrappedUserRootKey":"` + validWrapped + `","encryptionVersion":1,"plaintext":"forbidden"}`,
		`{"vaultUnlockSalt":"` + validSalt + `","wrappedUserRootKey":"%%%","encryptionVersion":1}`,
		`{"vaultUnlockSalt":"` + validSalt + `","wrappedUserRootKey":"` + validWrapped + `","encryptedPersonalVaultKey":null,"encryptionVersion":1}`,
	}
	for _, body := range cases {
		response := invokeProfileHandler(t, handler, http.MethodPost, body)
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "invalid_rewrap") {
			t.Errorf("invalid rewrap response=%d %s", response.Code, response.Body.String())
		}
	}
	if service.rewrapCalls != 0 {
		t.Fatalf("invalid rewrap reached persistence %d times", service.rewrapCalls)
	}
}

func TestMigrateUserCryptoProfileClearsBuffersAndMapsConflict(t *testing.T) {
	expected := profileEnvelope(1, 64)
	replacement := profileEnvelope(2, 65)
	payload := `{"encryptedPersonalVaultKey":{"expectedCiphertext":"` + base64.StdEncoding.EncodeToString(expected) + `","replacementCiphertext":"` + base64.StdEncoding.EncodeToString(replacement) + `"}}`
	service := &cryptoProfileServiceStub{migrationResult: application.UserCryptoProfileMigrationCommitted}
	dependencies, limiter, _ := authenticatedCryptoProfileDependencies(service)
	response := invokeProfileHandler(t, NewHandlers(dependencies).OperationHandlers()["postUsercryptoprofileMigration"], http.MethodPost, payload)
	if response.Code != http.StatusNoContent || response.Body.Len() != 0 {
		t.Fatalf("migration response=%d %q", response.Code, response.Body.String())
	}
	if limiter.calls != 1 || limiter.operation != "key_material_mutation" || service.migrationCalls != 1 {
		t.Fatalf("migration did not authorize and invoke one mutation: limiter=%#v service=%#v", limiter, service)
	}
	if len(service.migration.EncryptedPersonalVaultKey.ExpectedCiphertext) != len(expected) || service.migration.EncryptedPersonalVaultKey.ExpectedCiphertext[0] != 0 || service.migration.EncryptedPersonalVaultKey.ReplacementCiphertext[0] != 0 {
		t.Fatal("migration request ciphertext buffers were not cleared")
	}

	service = &cryptoProfileServiceStub{migrationResult: application.UserCryptoProfileMigrationConflict}
	dependencies, _, _ = authenticatedCryptoProfileDependencies(service)
	conflict := invokeProfileHandler(t, NewHandlers(dependencies).OperationHandlers()["postUsercryptoprofileMigration"], http.MethodPost, payload)
	if conflict.Code != http.StatusConflict || conflict.Body.String() != "{\"error\":\"profile_migration_conflict\"}\n" {
		t.Fatalf("conflict response=%d %q", conflict.Code, conflict.Body.String())
	}
}

func TestMigrateUserCryptoProfileRejectsMalformedAndUnsupportedObjects(t *testing.T) {
	service := &cryptoProfileServiceStub{migrationResult: application.UserCryptoProfileMigrationCommitted}
	dependencies, _, _ := authenticatedCryptoProfileDependencies(service)
	handler := NewHandlers(dependencies).OperationHandlers()["postUsercryptoprofileMigration"]
	expected := base64.StdEncoding.EncodeToString(profileEnvelope(1, 64))
	replacement := base64.StdEncoding.EncodeToString(profileEnvelope(2, 65))
	wrongVersion := base64.StdEncoding.EncodeToString(profileEnvelope(3, 65))
	cases := []string{
		`{}`,
		`{"wrappedUserRootKey":null}`,
		`{"unexpected":true}`,
		`{"wrappedUserRootKey":{"expectedCiphertext":"` + expected + `","replacementCiphertext":"` + replacement + `","extra":true}}`,
		`{"wrappedUserRootKey":{"expectedCiphertext":"` + expected + `","replacementCiphertext":"` + base64.StdEncoding.EncodeToString(profileEnvelope(1, 65)) + `"}}`,
		`{"wrappedUserRootKey":{"expectedCiphertext":"` + expected + `","replacementCiphertext":"` + wrongVersion + `"}}`,
		`{"wrappedUserRootKey":{"expectedCiphertext":"` + base64.StdEncoding.EncodeToString(make([]byte, 28)) + `","replacementCiphertext":"` + replacement + `"}}`,
	}
	for _, body := range cases {
		response := invokeProfileHandler(t, handler, http.MethodPost, body)
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "invalid_profile_migration") {
			t.Errorf("invalid profile migration response=%d %s", response.Code, response.Body.String())
		}
	}
	if service.migrationCalls != 0 {
		t.Fatalf("invalid profile migrations reached persistence %d times", service.migrationCalls)
	}
}

func TestPasswordlessEmailValidationMatchesPracticalEmailSchema(t *testing.T) {
	for _, email := range []string{"Person+tag@example.test", "o'hara@example.test", "name.surname@example.test"} {
		if !application.IsValidPasswordlessEmail(email) {
			t.Errorf("rejected valid synthetic email %q", email)
		}
	}
	for _, email := range []string{"dummy@example..test", "dummy@.example.test", "dummy@example.t", "dummy..name@example.test", "dummy name@example.test"} {
		if application.IsValidPasswordlessEmail(email) {
			t.Errorf("accepted invalid email %q", email)
		}
	}
}

func TestProfileAuthorizationMapsRateLimitAndMissingConfiguration(t *testing.T) {
	service := &cryptoProfileServiceStub{}
	dependencies, limiter, _ := authenticatedCryptoProfileDependencies(service)
	limiter.decision = application.RateLimitDecision{Allowed: false, RetryAfterSeconds: 19}
	limited := invokeProfileHandler(t, NewHandlers(dependencies).OperationHandlers()["postUsercryptoprofileRewrap"], http.MethodPost, "{}")
	if limited.Code != http.StatusTooManyRequests || limited.Header().Get("Retry-After") != "19" || service.rewrapCalls != 0 {
		t.Fatalf("mutation rate-limit response=%d headers=%v calls=%d", limited.Code, limited.Header(), service.rewrapCalls)
	}

	dependencies, _, _ = authenticatedCryptoProfileDependencies(service)
	dependencies.Authenticator.Sessions = &fakeSessionVerifier{}
	unauthorized := invokeProfileHandler(t, NewHandlers(dependencies).OperationHandlers()["postUsercryptoprofileRewrap"], http.MethodPost, "{}")
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated mutation response=%d", unauthorized.Code)
	}
}

func profileEnvelope(version byte, length int) []byte {
	result := make([]byte, length)
	result[0] = version
	for index := 1; index < len(result); index++ {
		result[index] = byte(index)
	}
	return result
}
