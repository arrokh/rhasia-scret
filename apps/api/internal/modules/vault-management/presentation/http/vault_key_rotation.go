package http

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	identity "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity"
	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity/application"
	vaultapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-management/application"
)

type VaultKeyRotationHandlers struct {
	authorizer httpapi.ApplicationRequestAuthorizer
	rotations  vaultapp.VaultKeyRotationRepository
}

func NewVaultKeyRotationHandlers(
	authorizer httpapi.ApplicationRequestAuthorizer,
	rotations vaultapp.VaultKeyRotationRepository,
) *VaultKeyRotationHandlers {
	return &VaultKeyRotationHandlers{authorizer: authorizer, rotations: rotations}
}

func (handlers *VaultKeyRotationHandlers) OperationHandlers() map[string]httpapi.OperationHandler {
	return map[string]httpapi.OperationHandler{
		"getSharedvaultsVaultIdRotation":   handlers.snapshot,
		"patchSharedvaultsVaultIdRotation": handlers.rotate,
	}
}

type vaultKeyRotationAccountRequest struct {
	ID               string                      `json:"id"`
	Revision         httpapi.PositiveSafeInteger `json:"revision"`
	EncryptedPayload string                      `json:"encryptedPayload"`
}

type vaultKeyRotationMemberRequest struct {
	UserID            string                     `json:"userId"`
	ExpectedPublicKey map[string]json.RawMessage `json:"expectedPublicKey"`
	EncryptedVaultKey string                     `json:"encryptedVaultKey"`
}

type vaultKeyRotationRequest struct {
	ExpectedEncryptedName string                           `json:"expectedEncryptedName"`
	EncryptedName         string                           `json:"encryptedName"`
	EncryptionVersion     httpapi.PositiveSafeInteger      `json:"encryptionVersion"`
	ExpectedKeyVersion    httpapi.PositiveSafeInteger      `json:"expectedKeyVersion"`
	KeyVersion            httpapi.PositiveSafeInteger      `json:"keyVersion"`
	Accounts              []vaultKeyRotationAccountRequest `json:"accounts"`
	MemberPackages        []vaultKeyRotationMemberRequest  `json:"memberPackages"`
}

type vaultKeyRotationSnapshotAccountResponse struct {
	ID                 string `json:"id"`
	EncryptedPayload   string `json:"encryptedPayload"`
	EncryptionVersion  int    `json:"encryptionVersion"`
	Revision           int64  `json:"revision"`
	RecoverableDeleted bool   `json:"recoverableDeleted"`
}

type vaultKeyRotationSnapshotMemberResponse struct {
	UserID     string                        `json:"userId"`
	PublicKey  *identity.PublicEncryptionKey `json:"publicKey"`
	KeyVersion *int64                        `json:"keyVersion"`
}

type vaultKeyRotationSnapshotResponse struct {
	VaultID                string                                    `json:"vaultId"`
	EncryptedName          string                                    `json:"encryptedName"`
	EncryptionVersion      int                                       `json:"encryptionVersion"`
	CurrentKeyVersion      *int64                                    `json:"currentKeyVersion"`
	PendingInvitationCount int                                       `json:"pendingInvitationCount"`
	Accounts               []vaultKeyRotationSnapshotAccountResponse `json:"accounts"`
	Members                []vaultKeyRotationSnapshotMemberResponse  `json:"members"`
}

func (handlers *VaultKeyRotationHandlers) snapshot(ctx *echo.Context) error {
	userID, authorized, err := handlers.authorize(ctx, "")
	if err != nil || !authorized {
		return err
	}
	if handlers.rotations == nil {
		return errors.New("Vault key rotation repository is not configured")
	}
	vaultID := ctx.Param("vaultId")
	if !httpapi.ValidRouteParameter(vaultID) {
		return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "invalid_vault_id"})
	}
	snapshot, err := handlers.rotations.Snapshot(ctx.Request().Context(), userID, vaultID)
	if err != nil {
		return err
	}
	if snapshot == nil {
		return ctx.JSON(http.StatusNotFound, httpapi.ApiError{Error: "rotation_unavailable"})
	}
	defer clearVaultKeyRotationSnapshot(snapshot)
	if !validRotationSnapshot(snapshot) {
		return ctx.JSON(http.StatusConflict, httpapi.ApiError{Error: "rotation_snapshot_unavailable"})
	}
	response := vaultKeyRotationSnapshotResponse{
		VaultID:                snapshot.VaultID,
		EncryptedName:          base64.StdEncoding.EncodeToString(snapshot.EncryptedName),
		EncryptionVersion:      snapshot.EncryptionVersion,
		CurrentKeyVersion:      snapshot.CurrentKeyVersion,
		PendingInvitationCount: snapshot.PendingInvitationCount,
		Accounts:               make([]vaultKeyRotationSnapshotAccountResponse, len(snapshot.Accounts)),
		Members:                make([]vaultKeyRotationSnapshotMemberResponse, len(snapshot.Members)),
	}
	for index, account := range snapshot.Accounts {
		response.Accounts[index] = vaultKeyRotationSnapshotAccountResponse{
			ID:                 account.ID,
			EncryptedPayload:   base64.StdEncoding.EncodeToString(account.EncryptedPayload),
			EncryptionVersion:  account.EncryptionVersion,
			Revision:           account.Revision,
			RecoverableDeleted: account.DeletedAt != nil,
		}
	}
	for index, member := range snapshot.Members {
		response.Members[index] = vaultKeyRotationSnapshotMemberResponse{
			UserID:     member.UserID,
			PublicKey:  member.PublicKey,
			KeyVersion: member.KeyVersion,
		}
	}
	serialized, err := json.Marshal(response)
	if err != nil {
		return err
	}
	if int64(len(serialized)) > httpapi.MaxRotationRequestBytes {
		return ctx.JSON(http.StatusConflict, httpapi.ApiError{Error: "rotation_snapshot_unavailable"})
	}
	return ctx.JSON(http.StatusOK, response)
}

func clearVaultKeyRotationSnapshot(snapshot *vaultapp.VaultKeyRotationSnapshot) {
	clear(snapshot.EncryptedName)
	for index := range snapshot.Accounts {
		clear(snapshot.Accounts[index].EncryptedPayload)
	}
}

func validRotationSnapshot(snapshot *vaultapp.VaultKeyRotationSnapshot) bool {
	if len(snapshot.Accounts) > vaultapp.MaxVaultKeyRotationAccounts ||
		len(snapshot.Members) > vaultapp.MaxVaultKeyRotationMemberPackages || snapshot.CurrentKeyVersion == nil ||
		len(snapshot.Members) == 0 || len(snapshot.EncryptedName) > httpapi.MaxEncryptedBlobBytes {
		return false
	}
	for _, member := range snapshot.Members {
		if member.KeyVersion == nil || *member.KeyVersion != *snapshot.CurrentKeyVersion || member.PublicKey == nil ||
			identity.ValidatePublicEncryptionKey(*member.PublicKey) != nil {
			return false
		}
	}
	for _, account := range snapshot.Accounts {
		if len(account.EncryptedPayload) > httpapi.MaxEncryptedBlobBytes {
			return false
		}
	}
	return true
}

func (handlers *VaultKeyRotationHandlers) rotate(ctx *echo.Context) error {
	userID, authorized, err := handlers.authorize(ctx, "key_material_mutation")
	if err != nil || !authorized {
		return err
	}
	if handlers.rotations == nil {
		return errors.New("Vault key rotation repository is not configured")
	}
	request, err := httpapi.DecodeJSONBody[vaultKeyRotationRequest](ctx.Request(), httpapi.MaxRotationRequestBytes)
	if err != nil || request.EncryptionVersion != 1 || request.ExpectedKeyVersion < 1 ||
		request.KeyVersion != request.ExpectedKeyVersion+1 || request.Accounts == nil || request.MemberPackages == nil ||
		len(request.Accounts) > vaultapp.MaxVaultKeyRotationAccounts ||
		len(request.MemberPackages) > vaultapp.MaxVaultKeyRotationMemberPackages {
		return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "invalid_rotation"})
	}
	vaultID := ctx.Param("vaultId")
	if !httpapi.ValidRouteParameter(vaultID) {
		return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "invalid_vault_id"})
	}
	rotation := vaultapp.VaultKeyRotation{
		EncryptionVersion:  int(request.EncryptionVersion),
		ExpectedKeyVersion: int64(request.ExpectedKeyVersion),
		KeyVersion:         int64(request.KeyVersion),
		Accounts:           make([]vaultapp.VaultKeyRotationAccountReplacement, len(request.Accounts)),
		MemberPackages:     make([]vaultapp.VaultKeyRotationMemberPackage, len(request.MemberPackages)),
	}
	rotation.ExpectedEncryptedName, err = decodeRotationCiphertext(request.ExpectedEncryptedName)
	if err != nil {
		return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "invalid_rotation"})
	}
	defer clear(rotation.ExpectedEncryptedName)
	rotation.EncryptedName, err = decodeRotationCiphertext(request.EncryptedName)
	if err != nil {
		return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "invalid_rotation"})
	}
	defer clear(rotation.EncryptedName)
	accountIDs := make(map[string]struct{}, len(request.Accounts))
	for index, account := range request.Accounts {
		if !httpapi.ValidStringLength(account.ID, 1, 128) || account.Revision < 1 {
			return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "invalid_rotation"})
		}
		if _, duplicate := accountIDs[account.ID]; duplicate {
			return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "invalid_rotation"})
		}
		accountIDs[account.ID] = struct{}{}
		ciphertext, err := decodeRotationCiphertext(account.EncryptedPayload)
		if err != nil {
			return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "invalid_rotation"})
		}
		rotation.Accounts[index] = vaultapp.VaultKeyRotationAccountReplacement{
			ID: account.ID, Revision: int64(account.Revision), EncryptedPayload: ciphertext,
		}
		defer clear(rotation.Accounts[index].EncryptedPayload)
	}
	memberIDs := make(map[string]struct{}, len(request.MemberPackages))
	for index, member := range request.MemberPackages {
		if !httpapi.ValidStringLength(member.UserID, 1, 128) {
			return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "invalid_rotation"})
		}
		if _, duplicate := memberIDs[member.UserID]; duplicate {
			return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "invalid_rotation"})
		}
		memberIDs[member.UserID] = struct{}{}
		publicKeyJSON, err := json.Marshal(member.ExpectedPublicKey)
		if err != nil {
			return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "invalid_rotation"})
		}
		publicKey, err := identityapp.ParseUserEncryptionPublicKey(publicKeyJSON)
		if err != nil {
			return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "invalid_rotation"})
		}
		ciphertext, err := decodeRotationCiphertext(member.EncryptedVaultKey)
		if err != nil {
			return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "invalid_rotation"})
		}
		rotation.MemberPackages[index] = vaultapp.VaultKeyRotationMemberPackage{
			UserID: member.UserID, ExpectedPublicKey: publicKey, EncryptedVaultKey: ciphertext,
		}
		defer clear(rotation.MemberPackages[index].EncryptedVaultKey)
	}
	rotated, err := handlers.rotations.Rotate(ctx.Request().Context(), userID, vaultID, rotation)
	if err != nil {
		return err
	}
	if !rotated {
		return ctx.JSON(http.StatusConflict, httpapi.ApiError{Error: "rotation_rejected"})
	}
	return ctx.NoContent(http.StatusNoContent)
}

func decodeRotationCiphertext(value string) ([]byte, error) {
	return httpapi.DecodeBoundedBase64(value, 13, httpapi.MaxEncryptedBlobBytes)
}

func (handlers *VaultKeyRotationHandlers) authorize(ctx *echo.Context, mutation string) (string, bool, error) {
	if handlers.authorizer == nil {
		return "", false, errors.New("application request authorizer is not configured")
	}
	userID, authorized, err := handlers.authorizer.AuthorizeApplicationRequest(ctx, mutation)
	if err != nil || !authorized {
		return "", authorized, err
	}
	if userID == "" {
		return "", false, errors.New("application request authorizer returned an empty user ID")
	}
	return userID, true, nil
}
