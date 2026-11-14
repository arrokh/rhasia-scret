package http

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	vaultapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/vault-management"
)

type personalVaultAuthorizerStub struct {
	ownerID    string
	authorized bool
	calls      int
	mutation   string
}

func (authorizer *personalVaultAuthorizerStub) AuthorizeApplicationRequest(ctx *echo.Context, mutation string) (string, bool, error) {
	authorizer.calls++
	authorizer.mutation = mutation
	if !authorizer.authorized {
		return "", false, ctx.JSON(http.StatusUnauthorized, httpapi.ApiError{Error: "unauthenticated"})
	}
	return authorizer.ownerID, true, nil
}

type personalVaultInitializerStub struct {
	calls        int
	ownerID      string
	input        vaultapp.PersonalVaultInitialization
	inputBuffers [][]byte
	err          error
}

func (initializer *personalVaultInitializerStub) Initialize(_ context.Context, ownerID string, input vaultapp.PersonalVaultInitialization) error {
	initializer.calls++
	initializer.ownerID = ownerID
	initializer.inputBuffers = [][]byte{
		input.VaultUnlockSalt, input.WrappedUserRootKey, input.EncryptedPersonalVaultKey,
		input.EncryptedVaultName, input.EncryptedUserPrivateKey,
	}
	initializer.input = vaultapp.PersonalVaultInitialization{
		VaultUnlockSalt:           append([]byte(nil), input.VaultUnlockSalt...),
		WrappedUserRootKey:        append([]byte(nil), input.WrappedUserRootKey...),
		EncryptedPersonalVaultKey: append([]byte(nil), input.EncryptedPersonalVaultKey...),
		EncryptedVaultName:        append([]byte(nil), input.EncryptedVaultName...),
		UserEncryptionPublicKey:   input.UserEncryptionPublicKey,
		EncryptedUserPrivateKey:   append([]byte(nil), input.EncryptedUserPrivateKey...),
		UserEncryptionKeyVersion:  input.UserEncryptionKeyVersion,
		EncryptionVersion:         input.EncryptionVersion,
	}
	return initializer.err
}

func TestInitializePersonalVaultMapsOpaqueDataAndClearsRequestBuffers(t *testing.T) {
	salt := make([]byte, 16)
	for index := range salt {
		salt[index] = byte(index + 1)
	}
	wrappedRootKey := personalVaultEnvelope(1, 13)
	personalVaultKey := personalVaultEnvelope(2, 14)
	vaultName := personalVaultEnvelope(1, 15)
	privateKey := personalVaultEnvelope(1, 16)
	publicKey := json.RawMessage(personalVaultPublicKeyJSON("A"))
	body, err := json.Marshal(map[string]any{
		"vaultUnlockSalt":           base64.StdEncoding.EncodeToString(salt),
		"wrappedUserRootKey":        base64.StdEncoding.EncodeToString(wrappedRootKey),
		"encryptedPersonalVaultKey": base64.StdEncoding.EncodeToString(personalVaultKey),
		"encryptedVaultName":        base64.StdEncoding.EncodeToString(vaultName),
		"userEncryptionPublicKey":   publicKey,
		"encryptedUserPrivateKey":   base64.StdEncoding.EncodeToString(privateKey),
		"userEncryptionKeyVersion":  1,
		"encryptionVersion":         1,
	})
	if err != nil {
		t.Fatal(err)
	}
	authorizer := &personalVaultAuthorizerStub{ownerID: "synthetic-owner", authorized: true}
	initializer := &personalVaultInitializerStub{}
	handler := NewHandlers(Dependencies{Authorizer: authorizer, Initializer: initializer}).OperationHandlers()["postPersonalvaultInitialize"]
	response := invokePersonalVaultHandler(t, handler, string(body))
	if response.Code != http.StatusNoContent || response.Body.Len() != 0 {
		t.Fatalf("initialization response=%d %q", response.Code, response.Body.String())
	}
	if authorizer.calls != 1 || authorizer.mutation != "key_material_mutation" || initializer.calls != 1 || initializer.ownerID != "synthetic-owner" {
		t.Fatalf("initialization did not authorize and invoke the Personal Vault initializer: auth=%#v initializer=%#v", authorizer, initializer)
	}
	if string(initializer.input.VaultUnlockSalt) != string(salt) || string(initializer.input.WrappedUserRootKey) != string(wrappedRootKey) ||
		string(initializer.input.EncryptedPersonalVaultKey) != string(personalVaultKey) || string(initializer.input.EncryptedVaultName) != string(vaultName) ||
		string(initializer.input.EncryptedUserPrivateKey) != string(privateKey) || initializer.input.UserEncryptionKeyVersion != 1 || initializer.input.EncryptionVersion != 1 ||
		initializer.input.UserEncryptionPublicKey.X != strings.Repeat("A", 43) {
		t.Fatal("Personal Vault initializer received unexpected encrypted values")
	}
	for _, buffer := range initializer.inputBuffers {
		if !allPersonalVaultBytesZero(buffer) {
			t.Fatal("request-owned cryptographic buffer was not cleared after initialization")
		}
	}
}

func TestInitializePersonalVaultRequiresFreshIdentityMutationAuthorization(t *testing.T) {
	authorizer := &personalVaultAuthorizerStub{authorized: false}
	initializer := &personalVaultInitializerStub{}
	handler := NewHandlers(Dependencies{Authorizer: authorizer, Initializer: initializer}).OperationHandlers()["postPersonalvaultInitialize"]
	response := invokePersonalVaultHandler(t, handler, "not-json")
	if response.Code != http.StatusUnauthorized || initializer.calls != 0 || authorizer.mutation != "key_material_mutation" {
		t.Fatalf("unauthorized initialization response=%d calls=%d mutation=%q", response.Code, initializer.calls, authorizer.mutation)
	}
}

func TestInitializePersonalVaultRejectsInvalidInputBeforePersistence(t *testing.T) {
	salt := base64.StdEncoding.EncodeToString(make([]byte, 16))
	ciphertext := base64.StdEncoding.EncodeToString(personalVaultEnvelope(1, 13))
	valid := `{"vaultUnlockSalt":"` + salt + `","wrappedUserRootKey":"` + ciphertext + `","encryptedPersonalVaultKey":"` + ciphertext + `","encryptedVaultName":"` + ciphertext + `","userEncryptionPublicKey":` + personalVaultPublicKeyJSON("A") + `,"encryptedUserPrivateKey":"` + ciphertext + `","userEncryptionKeyVersion":1,"encryptionVersion":1}`
	cases := []string{
		strings.Replace(valid, `"encryptionVersion":1`, `"encryptionVersion":2`, 1),
		strings.Replace(valid, `"vaultUnlockSalt":"`+salt+`"`, `"vaultUnlockSalt":"bad"`, 1),
		strings.Replace(valid, `"userEncryptionPublicKey":`+personalVaultPublicKeyJSON("A"), `"userEncryptionPublicKey":`+strings.TrimSuffix(personalVaultPublicKeyJSON("A"), "}")+`,"d":"synthetic-private-material"}`, 1),
		strings.TrimSuffix(valid, "}") + `,"unexpected":true}`,
		strings.Replace(valid, `"encryptedUserPrivateKey":"`+ciphertext+`"`, `"encryptedUserPrivateKey":null`, 1),
	}
	authorizer := &personalVaultAuthorizerStub{ownerID: "synthetic-owner", authorized: true}
	initializer := &personalVaultInitializerStub{}
	handler := NewHandlers(Dependencies{Authorizer: authorizer, Initializer: initializer}).OperationHandlers()["postPersonalvaultInitialize"]
	for _, body := range cases {
		response := invokePersonalVaultHandler(t, handler, body)
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "invalid_initialization") {
			t.Errorf("invalid initialization response=%d %s", response.Code, response.Body.String())
		}
	}
	if initializer.calls != 0 {
		t.Fatalf("invalid initialization reached persistence %d times", initializer.calls)
	}
}

func invokePersonalVaultHandler(t *testing.T, handler httpapi.OperationHandler, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/v1/personal-vault/initialize", strings.NewReader(body))
	response := httptest.NewRecorder()
	ctx := echo.New().NewContext(request, response)
	if err := handler(ctx); err != nil {
		t.Fatalf("Personal Vault handler returned error: %v", err)
	}
	return response
}

func personalVaultPublicKeyJSON(xCharacter string) string {
	return `{"kty":"EC","crv":"P-256","x":"` + strings.Repeat(xCharacter, 43) + `","y":"` + strings.Repeat("B", 43) + `","ext":true,"key_ops":[]}`
}

func personalVaultEnvelope(version byte, length int) []byte {
	value := make([]byte, length)
	value[0] = version
	for index := 1; index < length; index++ {
		value[index] = byte(index)
	}
	return value
}

func allPersonalVaultBytesZero(value []byte) bool {
	for _, byteValue := range value {
		if byteValue != 0 {
			return false
		}
	}
	return true
}
