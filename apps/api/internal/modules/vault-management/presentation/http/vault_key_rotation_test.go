package http

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity"
	vaultapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-management/application"
)

type vaultKeyRotationRepositoryStub struct {
	snapshot        *vaultapp.VaultKeyRotationSnapshot
	snapshotOwner   string
	snapshotVault   string
	snapshotCalls   int
	snapshotErr     error
	rotateOwner     string
	rotateVault     string
	rotateInput     vaultapp.VaultKeyRotation
	rotateInputCopy vaultapp.VaultKeyRotation
	rotateCalls     int
	rotateResult    bool
	rotateErr       error
}

func (repository *vaultKeyRotationRepositoryStub) Snapshot(_ context.Context, ownerID, vaultID string) (*vaultapp.VaultKeyRotationSnapshot, error) {
	repository.snapshotCalls++
	repository.snapshotOwner = ownerID
	repository.snapshotVault = vaultID
	return repository.snapshot, repository.snapshotErr
}

func (repository *vaultKeyRotationRepositoryStub) Rotate(_ context.Context, ownerID, vaultID string, input vaultapp.VaultKeyRotation) (bool, error) {
	repository.rotateCalls++
	repository.rotateOwner = ownerID
	repository.rotateVault = vaultID
	repository.rotateInput = input
	repository.rotateInputCopy = copyVaultKeyRotation(input)
	return repository.rotateResult, repository.rotateErr
}

func TestVaultKeyRotationSnapshotReturnsBoundedAuthorizedCiphertext(t *testing.T) {
	key, err := identity.ParsePublicEncryptionKey([]byte(personalVaultPublicKeyJSON("A")))
	if err != nil {
		t.Fatal(err)
	}
	keyVersion := int64(2)
	repository := &vaultKeyRotationRepositoryStub{snapshot: &vaultapp.VaultKeyRotationSnapshot{
		VaultID: "synthetic-vault", EncryptedName: personalVaultEnvelope(1, 13), EncryptionVersion: 1,
		CurrentKeyVersion: &keyVersion, PendingInvitationCount: 1,
		Accounts: []vaultapp.VaultKeyRotationAccountSnapshot{{
			ID: "synthetic-account", EncryptedPayload: personalVaultEnvelope(1, 14), EncryptionVersion: 1, Revision: 4,
		}},
		Members: []vaultapp.VaultKeyRotationMemberSnapshot{{UserID: "synthetic-owner", PublicKey: &key, KeyVersion: &keyVersion}},
	}}
	expectedEncryptedName := base64String(repository.snapshot.EncryptedName)
	expectedAccountPayload := base64String(repository.snapshot.Accounts[0].EncryptedPayload)
	authorizer := &personalVaultAuthorizerStub{ownerID: "synthetic-owner", authorized: true}
	handler := NewVaultKeyRotationHandlers(authorizer, repository).OperationHandlers()["getSharedvaultsVaultIdRotation"]
	response := invokeVaultKeyRotationHandler(t, handler, http.MethodGet, "/v1/shared-vaults/synthetic-vault/rotation", "", "synthetic-vault")
	if response.Code != http.StatusOK || authorizer.mutation != "" || authorizer.calls != 1 || repository.snapshotCalls != 1 ||
		repository.snapshotOwner != "synthetic-owner" || repository.snapshotVault != "synthetic-vault" {
		t.Fatalf("rotation snapshot response=%d %s auth=%#v repository=%#v", response.Code, response.Body.String(), authorizer, repository)
	}
	var body vaultKeyRotationSnapshotResponse
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode rotation snapshot response: %v", err)
	}
	if body.VaultID != "synthetic-vault" || body.EncryptedName != expectedEncryptedName ||
		body.CurrentKeyVersion == nil || *body.CurrentKeyVersion != 2 || body.PendingInvitationCount != 1 ||
		len(body.Accounts) != 1 || body.Accounts[0].ID != "synthetic-account" ||
		body.Accounts[0].EncryptedPayload != expectedAccountPayload || body.Accounts[0].Revision != 4 ||
		len(body.Members) != 1 || body.Members[0].UserID != "synthetic-owner" || body.Members[0].KeyVersion == nil || *body.Members[0].KeyVersion != 2 {
		t.Fatalf("unexpected rotation snapshot response: %#v", body)
	}
	if !allRotationBytesZero(repository.snapshot.EncryptedName) || !allRotationBytesZero(repository.snapshot.Accounts[0].EncryptedPayload) {
		t.Fatal("rotation snapshot ciphertext was not cleared after response serialization")
	}
}

func TestVaultKeyRotationSnapshotRejectsUnusableMemberState(t *testing.T) {
	key, err := identity.ParsePublicEncryptionKey([]byte(personalVaultPublicKeyJSON("B")))
	if err != nil {
		t.Fatal(err)
	}
	version := int64(1)
	repository := &vaultKeyRotationRepositoryStub{snapshot: &vaultapp.VaultKeyRotationSnapshot{
		VaultID: "synthetic-vault", EncryptedName: personalVaultEnvelope(1, 13), CurrentKeyVersion: &version,
		Members: []vaultapp.VaultKeyRotationMemberSnapshot{{UserID: "synthetic-member", PublicKey: nil, KeyVersion: &version}},
	}}
	authorizer := &personalVaultAuthorizerStub{ownerID: "synthetic-owner", authorized: true}
	handler := NewVaultKeyRotationHandlers(authorizer, repository).OperationHandlers()["getSharedvaultsVaultIdRotation"]
	response := invokeVaultKeyRotationHandler(t, handler, http.MethodGet, "/v1/shared-vaults/synthetic-vault/rotation", "", "synthetic-vault")
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "rotation_snapshot_unavailable") {
		t.Fatalf("unusable rotation snapshot response=%d %s", response.Code, response.Body.String())
	}
	repository.snapshot.Members[0].PublicKey = &key
	repository.snapshot.Members[0].KeyVersion = nil
	response = invokeVaultKeyRotationHandler(t, handler, http.MethodGet, "/v1/shared-vaults/synthetic-vault/rotation", "", "synthetic-vault")
	if response.Code != http.StatusConflict {
		t.Fatalf("rotation snapshot with missing member wrap response=%d %s", response.Code, response.Body.String())
	}
}

func TestVaultKeyRotationPatchMapsAuthorizedReplacementAndClearsCiphertextBuffers(t *testing.T) {
	ciphertext := base64String(personalVaultEnvelope(1, 15))
	body := `{"expectedEncryptedName":"` + ciphertext + `","encryptedName":"` + ciphertext + `","encryptionVersion":1,"expectedKeyVersion":2,"keyVersion":3,"accounts":[{"id":"synthetic-account","revision":4,"encryptedPayload":"` + ciphertext + `"}],"memberPackages":[{"userId":"synthetic-owner","expectedPublicKey":` + personalVaultPublicKeyJSON("C") + `,"encryptedVaultKey":"` + ciphertext + `"}]}`
	authorizer := &personalVaultAuthorizerStub{ownerID: "synthetic-owner", authorized: true}
	repository := &vaultKeyRotationRepositoryStub{rotateResult: true}
	handler := NewVaultKeyRotationHandlers(authorizer, repository).OperationHandlers()["patchSharedvaultsVaultIdRotation"]
	response := invokeVaultKeyRotationHandler(t, handler, http.MethodPatch, "/v1/shared-vaults/synthetic-vault/rotation", body, "synthetic-vault")
	if response.Code != http.StatusNoContent || response.Body.Len() != 0 || authorizer.mutation != "key_material_mutation" ||
		repository.rotateCalls != 1 || repository.rotateOwner != "synthetic-owner" || repository.rotateVault != "synthetic-vault" {
		t.Fatalf("rotation mutation response=%d %s auth=%#v repository=%#v", response.Code, response.Body.String(), authorizer, repository)
	}
	if repository.rotateInput.EncryptionVersion != 1 || repository.rotateInput.ExpectedKeyVersion != 2 || repository.rotateInput.KeyVersion != 3 ||
		len(repository.rotateInputCopy.Accounts) != 1 || repository.rotateInputCopy.Accounts[0].ID != "synthetic-account" || repository.rotateInputCopy.Accounts[0].Revision != 4 ||
		len(repository.rotateInputCopy.MemberPackages) != 1 || repository.rotateInputCopy.MemberPackages[0].ExpectedPublicKey.X != strings.Repeat("C", 43) {
		t.Fatalf("rotation application input differs from request: %#v", repository.rotateInputCopy)
	}
	buffers := [][]byte{repository.rotateInput.ExpectedEncryptedName, repository.rotateInput.EncryptedName}
	for _, account := range repository.rotateInput.Accounts {
		buffers = append(buffers, account.EncryptedPayload)
	}
	for _, member := range repository.rotateInput.MemberPackages {
		buffers = append(buffers, member.EncryptedVaultKey)
	}
	for _, buffer := range buffers {
		if !allRotationBytesZero(buffer) {
			t.Fatal("rotation request ciphertext buffer was not cleared")
		}
	}
}

func TestVaultKeyRotationPatchRejectsMalformedAndStaleRequests(t *testing.T) {
	ciphertext := base64String(personalVaultEnvelope(1, 16))
	valid := `{"expectedEncryptedName":"` + ciphertext + `","encryptedName":"` + ciphertext + `","encryptionVersion":1,"expectedKeyVersion":1,"keyVersion":2,"accounts":[],"memberPackages":[]}`
	authorizer := &personalVaultAuthorizerStub{ownerID: "synthetic-owner", authorized: true}
	repository := &vaultKeyRotationRepositoryStub{rotateResult: false}
	handler := NewVaultKeyRotationHandlers(authorizer, repository).OperationHandlers()["patchSharedvaultsVaultIdRotation"]
	invalidBodies := []string{
		strings.Replace(valid, `,"accounts":[]`, "", 1),
		strings.Replace(valid, `"keyVersion":2`, `"keyVersion":1`, 1),
		strings.Replace(valid, `"memberPackages":[]`, `"memberPackages":null`, 1),
		strings.TrimSuffix(valid, "}") + `,"unexpected":true}`,
	}
	for _, requestBody := range invalidBodies {
		response := invokeVaultKeyRotationHandler(t, handler, http.MethodPatch, "/v1/shared-vaults/synthetic-vault/rotation", requestBody, "synthetic-vault")
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "invalid_rotation") {
			t.Errorf("invalid rotation response=%d %s", response.Code, response.Body.String())
		}
	}
	duplicateAccounts := strings.Replace(valid, `"accounts":[]`, `"accounts":[{"id":"synthetic-account","revision":1,"encryptedPayload":"`+ciphertext+`"},{"id":"synthetic-account","revision":2,"encryptedPayload":"`+ciphertext+`"}]`, 1)
	response := invokeVaultKeyRotationHandler(t, handler, http.MethodPatch, "/v1/shared-vaults/synthetic-vault/rotation", duplicateAccounts, "synthetic-vault")
	if response.Code != http.StatusBadRequest || repository.rotateCalls != 0 {
		t.Fatalf("duplicate account rotation response=%d calls=%d %s", response.Code, repository.rotateCalls, response.Body.String())
	}
	response = invokeVaultKeyRotationHandler(t, handler, http.MethodPatch, "/v1/shared-vaults/synthetic-vault/rotation", valid, "synthetic-vault")
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "rotation_rejected") || repository.rotateCalls != 1 {
		t.Fatalf("stale rotation response=%d calls=%d %s", response.Code, repository.rotateCalls, response.Body.String())
	}
}

func TestVaultKeyRotationHandlersRequireAuthorizationAndMapUnavailableSnapshot(t *testing.T) {
	authorizer := &personalVaultAuthorizerStub{ownerID: "synthetic-owner", authorized: false}
	repository := &vaultKeyRotationRepositoryStub{}
	handlers := NewVaultKeyRotationHandlers(authorizer, repository).OperationHandlers()
	response := invokeVaultKeyRotationHandler(t, handlers["getSharedvaultsVaultIdRotation"], http.MethodGet, "/v1/shared-vaults/synthetic-vault/rotation", "", "synthetic-vault")
	if response.Code != http.StatusUnauthorized || repository.snapshotCalls != 0 {
		t.Fatalf("unauthorized snapshot response=%d calls=%d", response.Code, repository.snapshotCalls)
	}
	authorizer.authorized = true
	response = invokeVaultKeyRotationHandler(t, handlers["getSharedvaultsVaultIdRotation"], http.MethodGet, "/v1/shared-vaults/synthetic-vault/rotation", "", "synthetic-vault")
	if response.Code != http.StatusNotFound || !strings.Contains(response.Body.String(), "rotation_unavailable") {
		t.Fatalf("unavailable rotation response=%d %s", response.Code, response.Body.String())
	}
}

func invokeVaultKeyRotationHandler(t *testing.T, handler httpapi.OperationHandler, method, path, body, vaultID string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	response := httptest.NewRecorder()
	ctx := echo.New().NewContext(request, response)
	ctx.SetPathValues(echo.PathValues{{Name: "vaultId", Value: vaultID}})
	if err := handler(ctx); err != nil {
		t.Fatalf("Vault key rotation handler returned error: %v", err)
	}
	return response
}

func copyVaultKeyRotation(input vaultapp.VaultKeyRotation) vaultapp.VaultKeyRotation {
	output := input
	output.ExpectedEncryptedName = append([]byte(nil), input.ExpectedEncryptedName...)
	output.EncryptedName = append([]byte(nil), input.EncryptedName...)
	output.Accounts = append([]vaultapp.VaultKeyRotationAccountReplacement(nil), input.Accounts...)
	for index := range output.Accounts {
		output.Accounts[index].EncryptedPayload = append([]byte(nil), input.Accounts[index].EncryptedPayload...)
	}
	output.MemberPackages = append([]vaultapp.VaultKeyRotationMemberPackage(nil), input.MemberPackages...)
	for index := range output.MemberPackages {
		output.MemberPackages[index].EncryptedVaultKey = append([]byte(nil), input.MemberPackages[index].EncryptedVaultKey...)
	}
	return output
}

func allRotationBytesZero(value []byte) bool {
	for _, current := range value {
		if current != 0 {
			return false
		}
	}
	return true
}
