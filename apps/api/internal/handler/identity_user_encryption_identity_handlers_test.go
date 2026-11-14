package handler

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
)

type userEncryptionIdentityServiceStub struct {
	registered      bool
	registerErr     error
	registerInput   apiService.UserEncryptionIdentity
	registerUserID  string
	registerCalls   int
	migrationResult apiService.UserEncryptionPrivateKeyMigrationResult
	migrationErr    error
	migrationInput  apiService.UserEncryptionPrivateKeyMigration
	migrationUserID string
	migrationCalls  int
}

func (service *userEncryptionIdentityServiceStub) Register(_ context.Context, userID string, identity apiService.UserEncryptionIdentity) (bool, error) {
	service.registerCalls++
	service.registerUserID = userID
	service.registerInput = identity
	return service.registered, service.registerErr
}

func (service *userEncryptionIdentityServiceStub) MigratePrivateKey(_ context.Context, userID string, migration apiService.UserEncryptionPrivateKeyMigration) (apiService.UserEncryptionPrivateKeyMigrationResult, error) {
	service.migrationCalls++
	service.migrationUserID = userID
	service.migrationInput = migration
	return service.migrationResult, service.migrationErr
}

type userEncryptionIdentityRotationServiceStub struct {
	snapshot      *apiService.UserEncryptionIdentityRotationSnapshot
	snapshotErr   error
	snapshotUser  string
	snapshotCalls int
	rotated       bool
	rotateErr     error
	rotation      apiService.UserEncryptionIdentityRotation
	rotationUser  string
	rotateCalls   int
}

func (service *userEncryptionIdentityRotationServiceStub) Snapshot(_ context.Context, userID string) (*apiService.UserEncryptionIdentityRotationSnapshot, error) {
	service.snapshotCalls++
	service.snapshotUser = userID
	return service.snapshot, service.snapshotErr
}

func (service *userEncryptionIdentityRotationServiceStub) Rotate(_ context.Context, userID string, rotation apiService.UserEncryptionIdentityRotation) (bool, error) {
	service.rotateCalls++
	service.rotationUser = userID
	service.rotation = rotation
	return service.rotated, service.rotateErr
}

func authenticatedUserEncryptionIdentityDependencies() (IdentityDependencies, *cryptoProfileRateLimiter, *fakeSessionVerifier) {
	dependencies, limiter, verifier := authenticatedCryptoProfileDependencies(&cryptoProfileServiceStub{})
	return dependencies, limiter, verifier
}

func invokeUserEncryptionIdentityHandler(t *testing.T, handler httpapi.OperationHandler, method string, path string, body string) *httptest.ResponseRecorder {
	t.Helper()
	return invokeHandler(t, handler, method, path, body, requestHeaders(testWebOrigin), true)
}

func TestRegisterUserEncryptionIdentityValidatesAndClearsEncryptedInput(t *testing.T) {
	ciphertext := profileEnvelope(1, 13)
	publicKey := json.RawMessage(identityPublicKeyJSON("A"))
	body, err := json.Marshal(map[string]any{
		"publicKey": publicKey, "encryptedPrivateKey": base64.StdEncoding.EncodeToString(ciphertext), "encryptionVersion": 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	service := &userEncryptionIdentityServiceStub{registered: true}
	dependencies, limiter, verifier := authenticatedUserEncryptionIdentityDependencies()
	dependencies.EncryptionIdentity = service
	handler := NewIdentityHandlers(dependencies).OperationHandlers()["putUserencryptionidentity"]
	response := invokeUserEncryptionIdentityHandler(t, handler, http.MethodPut, "/v1/user-encryption-identity", string(body))
	if response.Code != http.StatusNoContent || response.Body.Len() != 0 {
		t.Fatalf("registration response=%d %q", response.Code, response.Body.String())
	}
	if service.registerCalls != 1 || service.registerUserID != "synthetic-user" || limiter.calls != 1 ||
		limiter.operation != "key_material_mutation" || verifier.minimum != apiService.AssuranceFreshProvider {
		t.Fatalf("registration did not apply mutation authorization: service=%#v limiter=%#v assurance=%q", service, limiter, verifier.minimum)
	}
	if len(service.registerInput.EncryptedPrivateKey) != len(ciphertext) || !allZeroBytes(service.registerInput.EncryptedPrivateKey) {
		t.Fatal("registration ciphertext was not cleared after persistence")
	}
	if service.registerInput.PublicKey.Kty != "EC" || service.registerInput.PublicKey.Crv != "P-256" || service.registerInput.PublicKey.Ext == nil || *service.registerInput.PublicKey.Ext {
		t.Fatalf("public-key optional fields were not preserved: %#v", service.registerInput.PublicKey)
	}
}

func TestRegisterUserEncryptionIdentityRejectsPrivateAndUnsupportedPublicKeyFields(t *testing.T) {
	service := &userEncryptionIdentityServiceStub{registered: true}
	dependencies, _, _ := authenticatedUserEncryptionIdentityDependencies()
	dependencies.EncryptionIdentity = service
	handler := NewIdentityHandlers(dependencies).OperationHandlers()["putUserencryptionidentity"]
	ciphertext := base64.StdEncoding.EncodeToString(profileEnvelope(1, 13))
	cases := []string{
		`{"publicKey":{"kty":"EC","crv":"P-256","x":"` + strings.Repeat("A", 43) + `","y":"` + strings.Repeat("B", 43) + `","d":"synthetic-private-material"},"encryptedPrivateKey":"` + ciphertext + `","encryptionVersion":1}`,
		`{"publicKey":{"kty":"EC","crv":"P-256","x":"` + strings.Repeat("A", 43) + `","y":"` + strings.Repeat("B", 43) + `","ext":null},"encryptedPrivateKey":"` + ciphertext + `","encryptionVersion":1}`,
		`{"publicKey":{"kty":"EC","crv":"P-256","x":"` + strings.Repeat("A", 43) + `","y":"` + strings.Repeat("B", 43) + `"},"encryptedPrivateKey":"` + ciphertext + `","encryptionVersion":1,"extra":true}`,
		`{"publicKey":{"kty":"EC","crv":"P-256","x":"` + strings.Repeat("A", 43) + `","y":"` + strings.Repeat("B", 43) + `"},"encryptedPrivateKey":"` + ciphertext + `","encryptionVersion":2}`,
	}
	for _, body := range cases {
		response := invokeUserEncryptionIdentityHandler(t, handler, http.MethodPut, "/v1/user-encryption-identity", body)
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "invalid_identity") {
			t.Errorf("invalid registration response=%d %s", response.Code, response.Body.String())
		}
	}
	if service.registerCalls != 0 {
		t.Fatalf("invalid public identities reached persistence %d times", service.registerCalls)
	}
}

func TestRegisterUserEncryptionIdentityMapsExistingIdentityAndRateLimit(t *testing.T) {
	ciphertext := base64.StdEncoding.EncodeToString(profileEnvelope(1, 13))
	body := `{"publicKey":` + identityPublicKeyJSON("A") + `,"encryptedPrivateKey":"` + ciphertext + `","encryptionVersion":1}`
	service := &userEncryptionIdentityServiceStub{}
	dependencies, limiter, _ := authenticatedUserEncryptionIdentityDependencies()
	dependencies.EncryptionIdentity = service
	handler := NewIdentityHandlers(dependencies).OperationHandlers()["putUserencryptionidentity"]
	response := invokeUserEncryptionIdentityHandler(t, handler, http.MethodPut, "/v1/user-encryption-identity", body)
	if response.Code != http.StatusConflict || response.Body.String() != "{\"error\":\"identity_already_registered\"}\n" {
		t.Fatalf("existing identity response=%d %q", response.Code, response.Body.String())
	}
	limiter.decision = apiService.RateLimitDecision{Allowed: false, RetryAfterSeconds: 23}
	limited := invokeUserEncryptionIdentityHandler(t, handler, http.MethodPut, "/v1/user-encryption-identity", body)
	if limited.Code != http.StatusTooManyRequests || limited.Header().Get("Retry-After") != "23" || service.registerCalls != 1 {
		t.Fatalf("rate-limited identity response=%d headers=%v persistence calls=%d", limited.Code, limited.Header(), service.registerCalls)
	}
}

func TestMigrateUserEncryptionPrivateKeyValidatesAndClearsBuffers(t *testing.T) {
	replacement := profileEnvelope(2, 64)
	digest := identityCiphertextDigest(replacement)
	body := `{"expectedEnvelopeVersion":1,"replacementEnvelopeVersion":2,"userEncryptionKeyVersion":1,"expectedCiphertextDigest":"` + identityCiphertextDigest(profileEnvelope(1, 64)) + `","replacementCiphertextDigest":"` + digest + `","encryptedPrivateKey":"` + base64.StdEncoding.EncodeToString(replacement) + `","operationId":"` + digest + `"}`
	service := &userEncryptionIdentityServiceStub{migrationResult: apiService.UserEncryptionPrivateKeyMigrationCommitted}
	dependencies, limiter, _ := authenticatedUserEncryptionIdentityDependencies()
	dependencies.EncryptionIdentity = service
	handler := NewIdentityHandlers(dependencies).OperationHandlers()["postUserencryptionidentityMigration"]
	response := invokeUserEncryptionIdentityHandler(t, handler, http.MethodPost, "/v1/user-encryption-identity/migration", body)
	if response.Code != http.StatusNoContent || response.Body.Len() != 0 {
		t.Fatalf("migration response=%d %q", response.Code, response.Body.String())
	}
	if service.migrationCalls != 1 || service.migrationUserID != "synthetic-user" || limiter.calls != 1 || limiter.operation != "key_material_mutation" {
		t.Fatalf("migration did not apply mutation auth: service=%#v limiter=%#v", service, limiter)
	}
	if len(service.migrationInput.EncryptedPrivateKey) != len(replacement) || !allZeroBytes(service.migrationInput.EncryptedPrivateKey) {
		t.Fatal("migration ciphertext was not cleared after persistence")
	}
	service.migrationResult = apiService.UserEncryptionPrivateKeyMigrationConflict
	conflict := invokeUserEncryptionIdentityHandler(t, handler, http.MethodPost, "/v1/user-encryption-identity/migration", body)
	if conflict.Code != http.StatusConflict || conflict.Body.String() != "{\"error\":\"identity_migration_conflict\"}\n" {
		t.Fatalf("migration conflict response=%d %q", conflict.Code, conflict.Body.String())
	}
}

func TestMigrateUserEncryptionPrivateKeyRejectsInvalidDigestsAndEnvelope(t *testing.T) {
	service := &userEncryptionIdentityServiceStub{}
	dependencies, _, _ := authenticatedUserEncryptionIdentityDependencies()
	dependencies.EncryptionIdentity = service
	handler := NewIdentityHandlers(dependencies).OperationHandlers()["postUserencryptionidentityMigration"]
	replacement := profileEnvelope(2, 64)
	digest := identityCiphertextDigest(replacement)
	base := `{"expectedEnvelopeVersion":1,"replacementEnvelopeVersion":2,"userEncryptionKeyVersion":1,"expectedCiphertextDigest":"` + identityCiphertextDigest(profileEnvelope(1, 64)) + `","replacementCiphertextDigest":"` + digest + `","encryptedPrivateKey":"` + base64.StdEncoding.EncodeToString(replacement) + `","operationId":"` + digest + `"}`
	cases := []string{
		strings.Replace(base, `"operationId":"`+digest+`"`, `"operationId":"`+strings.Repeat("A", 43)+`"`, 1),
		strings.Replace(base, `"replacementEnvelopeVersion":2`, `"replacementEnvelopeVersion":3`, 1),
		strings.Replace(base, `"encryptedPrivateKey":"`+base64.StdEncoding.EncodeToString(replacement)+`"`, `"encryptedPrivateKey":"`+base64.StdEncoding.EncodeToString(profileEnvelope(1, 64))+`"`, 1),
		strings.TrimSuffix(base, "}") + `,"unexpected":true}`,
	}
	for _, body := range cases {
		response := invokeUserEncryptionIdentityHandler(t, handler, http.MethodPost, "/v1/user-encryption-identity/migration", body)
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "invalid_identity_migration") {
			t.Errorf("invalid migration response=%d %s", response.Code, response.Body.String())
		}
	}
	if service.migrationCalls != 0 {
		t.Fatalf("invalid private-key migrations reached persistence %d times", service.migrationCalls)
	}
}

func TestGetUserEncryptionIdentityRotationReturnsEncryptedSnapshotOnly(t *testing.T) {
	privateKey := profileEnvelope(1, 13)
	vaultKey := profileEnvelope(2, 13)
	privateKeyEncoded := base64.StdEncoding.EncodeToString(privateKey)
	vaultKeyEncoded := base64.StdEncoding.EncodeToString(vaultKey)
	snapshot := &apiService.UserEncryptionIdentityRotationSnapshot{
		PublicKey: json.RawMessage(identityPublicKeyJSON("A")), EncryptedPrivateKey: privateKey, EncryptionVersion: 1,
		Memberships: []apiService.UserEncryptionIdentityRotationMembership{{
			VaultID: "vault-synthetic", OwnerID: "another-synthetic-owner", EncryptedVaultKey: vaultKey, KeyVersion: 3,
		}},
	}
	service := &userEncryptionIdentityRotationServiceStub{snapshot: snapshot}
	dependencies, limiter, verifier := authenticatedUserEncryptionIdentityDependencies()
	dependencies.EncryptionIdentityRotation = service
	handler := NewIdentityHandlers(dependencies).OperationHandlers()["getUserencryptionidentityRotation"]
	response := invokeUserEncryptionIdentityHandler(t, handler, http.MethodGet, "/v1/user-encryption-identity/rotation", "")
	if response.Code != http.StatusOK {
		t.Fatalf("snapshot response=%d %s", response.Code, response.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode snapshot: %v", err)
	}
	memberships, ok := payload["memberships"].([]any)
	if !ok || len(memberships) != 1 || payload["encryptedPrivateKey"] != privateKeyEncoded {
		t.Fatalf("unexpected snapshot response: %#v", payload)
	}
	membership, ok := memberships[0].(map[string]any)
	if !ok || membership["vaultId"] != "vault-synthetic" || membership["keyVersion"] != float64(3) || membership["encryptedVaultKey"] != vaultKeyEncoded {
		t.Fatalf("unexpected membership response: %#v", memberships)
	}
	if _, leaked := membership["ownerId"]; leaked || service.snapshotUser != "synthetic-user" || limiter.calls != 0 || verifier.minimum != apiService.AssuranceFreshProvider {
		t.Fatal("snapshot leaked owner or identity data, or used mutation authentication")
	}
	if !allZeroBytes(snapshot.EncryptedPrivateKey) || !allZeroBytes(snapshot.Memberships[0].EncryptedVaultKey) {
		t.Fatal("snapshot ciphertext buffers were not cleared after response serialization")
	}
}

func TestGetUserEncryptionIdentityRotationRejectsMalformedSnapshots(t *testing.T) {
	snapshot := &apiService.UserEncryptionIdentityRotationSnapshot{
		PublicKey:           json.RawMessage(strings.TrimSuffix(identityPublicKeyJSON("A"), "}") + `,"d":"synthetic-private-material"}`),
		EncryptedPrivateKey: profileEnvelope(1, 13), EncryptionVersion: 1,
	}
	service := &userEncryptionIdentityRotationServiceStub{snapshot: snapshot}
	dependencies, _, _ := authenticatedUserEncryptionIdentityDependencies()
	dependencies.EncryptionIdentityRotation = service
	handler := NewIdentityHandlers(dependencies).OperationHandlers()["getUserencryptionidentityRotation"]
	response := invokeUserEncryptionIdentityHandler(t, handler, http.MethodGet, "/v1/user-encryption-identity/rotation", "")
	if response.Code != http.StatusConflict || response.Body.String() != "{\"error\":\"identity_rotation_unavailable\"}\n" ||
		strings.Contains(response.Body.String(), "synthetic-private-material") {
		t.Fatalf("malformed identity snapshot response=%d %q", response.Code, response.Body.String())
	}
}

func TestPatchUserEncryptionIdentityRotationMapsInputAndClearsCiphertext(t *testing.T) {
	oldPrivate := profileEnvelope(1, 13)
	newPrivate := profileEnvelope(2, 14)
	oldVaultKey := profileEnvelope(1, 13)
	newVaultKey := profileEnvelope(2, 14)
	oldPublicKey := identityPublicKeyJSON("A")
	newPublicKey := identityPublicKeyJSON("C")
	body := `{"expectedPublicKey":` + oldPublicKey + `,"expectedEncryptedPrivateKey":"` + base64.StdEncoding.EncodeToString(oldPrivate) + `","expectedEncryptionVersion":1,"publicKey":` + newPublicKey + `,"encryptedPrivateKey":"` + base64.StdEncoding.EncodeToString(newPrivate) + `","encryptionVersion":1,"memberships":[{"vaultId":"vault-synthetic","expectedKeyVersion":3,"expectedEncryptedVaultKey":"` + base64.StdEncoding.EncodeToString(oldVaultKey) + `","encryptedVaultKey":"` + base64.StdEncoding.EncodeToString(newVaultKey) + `"}]}`
	service := &userEncryptionIdentityRotationServiceStub{rotated: true}
	dependencies, limiter, verifier := authenticatedUserEncryptionIdentityDependencies()
	dependencies.EncryptionIdentityRotation = service
	handler := NewIdentityHandlers(dependencies).OperationHandlers()["patchUserencryptionidentityRotation"]
	response := invokeUserEncryptionIdentityHandler(t, handler, http.MethodPatch, "/v1/user-encryption-identity/rotation", body)
	if response.Code != http.StatusNoContent || response.Body.Len() != 0 {
		t.Fatalf("rotation response=%d %q", response.Code, response.Body.String())
	}
	if service.rotateCalls != 1 || service.rotationUser != "synthetic-user" || limiter.calls != 1 || limiter.operation != "key_material_mutation" || verifier.minimum != apiService.AssuranceFreshProvider {
		t.Fatalf("rotation did not apply mutation authorization: service=%#v limiter=%#v assurance=%q", service, limiter, verifier.minimum)
	}
	rotation := service.rotation
	if rotation.ExpectedPublicKey.X != strings.Repeat("A", 43) || rotation.PublicKey.X != strings.Repeat("C", 43) ||
		!allZeroBytes(rotation.ExpectedEncryptedPrivateKey) || !allZeroBytes(rotation.EncryptedPrivateKey) || len(rotation.Memberships) != 1 ||
		!allZeroBytes(rotation.Memberships[0].ExpectedVaultKey) || !allZeroBytes(rotation.Memberships[0].ReplacementVaultKey) {
		t.Fatal("rotation material was not mapped and cleared after persistence")
	}
}

func TestPatchUserEncryptionIdentityRotationRejectsInvalidMembershipsAndMapsConflict(t *testing.T) {
	privateKey := base64.StdEncoding.EncodeToString(profileEnvelope(1, 13))
	vaultKey := base64.StdEncoding.EncodeToString(profileEnvelope(1, 13))
	body := `{"expectedPublicKey":` + identityPublicKeyJSON("A") + `,"expectedEncryptedPrivateKey":"` + privateKey + `","expectedEncryptionVersion":1,"publicKey":` + identityPublicKeyJSON("C") + `,"encryptedPrivateKey":"` + privateKey + `","encryptionVersion":1,"memberships":[{"vaultId":"vault-synthetic","expectedKeyVersion":3,"expectedEncryptedVaultKey":"` + vaultKey + `","encryptedVaultKey":"` + vaultKey + `"}]}`
	service := &userEncryptionIdentityRotationServiceStub{}
	dependencies, _, _ := authenticatedUserEncryptionIdentityDependencies()
	dependencies.EncryptionIdentityRotation = service
	handler := NewIdentityHandlers(dependencies).OperationHandlers()["patchUserencryptionidentityRotation"]
	var payload map[string]any
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		t.Fatalf("decode valid rotation body: %v", err)
	}
	memberships := payload["memberships"].([]any)
	payload["memberships"] = nil
	nullMembershipsBody, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal null membership body: %v", err)
	}
	payload["memberships"] = []any{memberships[0], memberships[0]}
	duplicateMembershipsBody, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal duplicate membership body: %v", err)
	}
	invalidBodies := []string{
		strings.TrimSuffix(body, "}") + `,"unexpected":true}`,
		string(nullMembershipsBody),
		string(duplicateMembershipsBody),
	}
	for _, invalid := range invalidBodies {
		response := invokeUserEncryptionIdentityHandler(t, handler, http.MethodPatch, "/v1/user-encryption-identity/rotation", invalid)
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "invalid_identity_rotation") {
			t.Errorf("invalid rotation response=%d %s", response.Code, response.Body.String())
		}
	}
	if service.rotateCalls != 0 {
		t.Fatalf("invalid identity rotations reached persistence %d times", service.rotateCalls)
	}
	service.rotated = false
	conflict := invokeUserEncryptionIdentityHandler(t, handler, http.MethodPatch, "/v1/user-encryption-identity/rotation", body)
	if conflict.Code != http.StatusConflict || conflict.Body.String() != "{\"error\":\"identity_rotation_rejected\"}\n" {
		t.Fatalf("stale rotation response=%d %q", conflict.Code, conflict.Body.String())
	}
}

func identityPublicKeyJSON(xCharacter string) string {
	return `{"kty":"EC","crv":"P-256","x":"` + strings.Repeat(xCharacter, 43) + `","y":"` + strings.Repeat("B", 43) + `","ext":false,"key_ops":[]}`
}

func identityCiphertextDigest(value []byte) string {
	digest := sha256.Sum256(value)
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

func allZeroBytes(value []byte) bool {
	for _, byteValue := range value {
		if byteValue != 0 {
			return false
		}
	}
	return true
}
