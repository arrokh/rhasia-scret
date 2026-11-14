package http

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/identity"
)

type UserEncryptionIdentityService interface {
	Register(context.Context, string, identityapp.UserEncryptionIdentity) (bool, error)
	MigratePrivateKey(context.Context, string, identityapp.UserEncryptionPrivateKeyMigration) (identityapp.UserEncryptionPrivateKeyMigrationResult, error)
}

type UserEncryptionIdentityRotationService interface {
	Snapshot(context.Context, string) (*identityapp.UserEncryptionIdentityRotationSnapshot, error)
	Rotate(context.Context, string, identityapp.UserEncryptionIdentityRotation) (bool, error)
}

type userEncryptionIdentityRegistrationRequest struct {
	PublicKey           map[string]json.RawMessage `json:"publicKey"`
	EncryptedPrivateKey string                     `json:"encryptedPrivateKey"`
	EncryptionVersion   int                        `json:"encryptionVersion"`
}

func (handlers *Handlers) putUserEncryptionIdentity(ctx *echo.Context) error {
	user, authorized, err := handlers.authorizeApplicationRequest(ctx, "key_material_mutation")
	if err != nil || !authorized {
		return err
	}
	if handlers.dependencies.EncryptionIdentity == nil {
		return errors.New("user encryption identity service is unavailable")
	}
	request, err := httpapi.DecodeJSONBody[userEncryptionIdentityRegistrationRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || request.EncryptionVersion != 1 {
		return writeAPIError(ctx, http.StatusBadRequest, "invalid_identity")
	}
	publicKey, err := parseRequestPublicEncryptionKey(request.PublicKey)
	if err != nil {
		return writeAPIError(ctx, http.StatusBadRequest, "invalid_identity")
	}
	encryptedPrivateKey, err := httpapi.DecodeBoundedBase64(request.EncryptedPrivateKey, 13, httpapi.MaxEncryptedBlobBytes)
	if err != nil {
		return writeAPIError(ctx, http.StatusBadRequest, "invalid_identity")
	}
	defer clear(encryptedPrivateKey)
	registered, err := handlers.dependencies.EncryptionIdentity.Register(ctx.Request().Context(), user.ID, identityapp.UserEncryptionIdentity{
		PublicKey: publicKey, EncryptedPrivateKey: encryptedPrivateKey, EncryptionVersion: request.EncryptionVersion,
	})
	if err != nil {
		return err
	}
	if !registered {
		return writeAPIError(ctx, http.StatusConflict, "identity_already_registered")
	}
	return ctx.NoContent(http.StatusNoContent)
}

type userEncryptionPrivateKeyMigrationRequest struct {
	ExpectedEnvelopeVersion     int    `json:"expectedEnvelopeVersion"`
	ReplacementEnvelopeVersion  int    `json:"replacementEnvelopeVersion"`
	UserEncryptionKeyVersion    int    `json:"userEncryptionKeyVersion"`
	ExpectedCiphertextDigest    string `json:"expectedCiphertextDigest"`
	ReplacementCiphertextDigest string `json:"replacementCiphertextDigest"`
	EncryptedPrivateKey         string `json:"encryptedPrivateKey"`
	OperationID                 string `json:"operationId"`
}

func (handlers *Handlers) migrateUserEncryptionPrivateKey(ctx *echo.Context) error {
	user, authorized, err := handlers.authorizeApplicationRequest(ctx, "key_material_mutation")
	if err != nil || !authorized {
		return err
	}
	if handlers.dependencies.EncryptionIdentity == nil {
		return errors.New("user encryption identity service is unavailable")
	}
	request, err := httpapi.DecodeJSONBody[userEncryptionPrivateKeyMigrationRequest](ctx.Request(), httpapi.MaxJSONBodyBytes)
	if err != nil || request.ExpectedEnvelopeVersion != 1 || request.ReplacementEnvelopeVersion != 2 ||
		request.UserEncryptionKeyVersion < 1 || !validCanonicalSHA256Digest(request.ExpectedCiphertextDigest) ||
		!validCanonicalSHA256Digest(request.ReplacementCiphertextDigest) || request.OperationID != request.ReplacementCiphertextDigest {
		return writeAPIError(ctx, http.StatusBadRequest, "invalid_identity_migration")
	}
	encryptedPrivateKey, err := httpapi.DecodeBoundedBase64(request.EncryptedPrivateKey, 30, httpapi.MaxEncryptedBlobBytes)
	if err != nil {
		return writeAPIError(ctx, http.StatusBadRequest, "invalid_identity_migration")
	}
	defer clear(encryptedPrivateKey)
	if encryptedPrivateKey[0] != byte(request.ReplacementEnvelopeVersion) {
		return writeAPIError(ctx, http.StatusBadRequest, "invalid_identity_migration")
	}
	result, err := handlers.dependencies.EncryptionIdentity.MigratePrivateKey(ctx.Request().Context(), user.ID, identityapp.UserEncryptionPrivateKeyMigration{
		ExpectedEnvelopeVersion: request.ExpectedEnvelopeVersion, ReplacementEnvelopeVersion: request.ReplacementEnvelopeVersion,
		UserEncryptionKeyVersion: request.UserEncryptionKeyVersion, ExpectedCiphertextDigest: request.ExpectedCiphertextDigest,
		ReplacementCiphertextDigest: request.ReplacementCiphertextDigest, EncryptedPrivateKey: encryptedPrivateKey, OperationID: request.OperationID,
	})
	if err != nil {
		return err
	}
	if result == identityapp.UserEncryptionPrivateKeyMigrationConflict {
		return writeAPIError(ctx, http.StatusConflict, "identity_migration_conflict")
	}
	if result != identityapp.UserEncryptionPrivateKeyMigrationCommitted && result != identityapp.UserEncryptionPrivateKeyMigrationAlreadyCommitted {
		return errors.New("user encryption private-key migration returned an unsupported result")
	}
	return ctx.NoContent(http.StatusNoContent)
}

func (handlers *Handlers) getUserEncryptionIdentityRotation(ctx *echo.Context) error {
	user, authorized, err := handlers.authorizeApplicationRequest(ctx, "")
	if err != nil || !authorized {
		return err
	}
	if handlers.dependencies.EncryptionIdentityRotation == nil {
		return errors.New("user encryption identity rotation service is unavailable")
	}
	snapshot, err := handlers.dependencies.EncryptionIdentityRotation.Snapshot(ctx.Request().Context(), user.ID)
	if err != nil {
		return err
	}
	if snapshot == nil {
		return writeAPIError(ctx, http.StatusConflict, "identity_rotation_unavailable")
	}
	defer clearUserEncryptionIdentityRotationSnapshot(snapshot)
	if snapshot.EncryptionVersion != 1 || len(snapshot.EncryptedPrivateKey) < 13 || len(snapshot.EncryptedPrivateKey) > httpapi.MaxEncryptedBlobBytes ||
		len(snapshot.Memberships) > httpapi.MaxRotationMemberPackages {
		return writeAPIError(ctx, http.StatusConflict, "identity_rotation_unavailable")
	}
	publicKey, err := identityapp.ParseUserEncryptionPublicKey(snapshot.PublicKey)
	if err != nil {
		return writeAPIError(ctx, http.StatusConflict, "identity_rotation_unavailable")
	}
	response := userEncryptionIdentityRotationSnapshotResponse{
		PublicKey: publicKey, EncryptedPrivateKey: base64.StdEncoding.EncodeToString(snapshot.EncryptedPrivateKey),
		EncryptionVersion: snapshot.EncryptionVersion, Memberships: make([]userEncryptionIdentityRotationMembershipResponse, 0, len(snapshot.Memberships)),
	}
	for _, membership := range snapshot.Memberships {
		if membership.KeyVersion < 1 || len(membership.EncryptedVaultKey) < 13 || len(membership.EncryptedVaultKey) > httpapi.MaxEncryptedBlobBytes {
			return writeAPIError(ctx, http.StatusConflict, "identity_rotation_unavailable")
		}
		response.Memberships = append(response.Memberships, userEncryptionIdentityRotationMembershipResponse{
			VaultID: membership.VaultID, KeyVersion: membership.KeyVersion,
			EncryptedVaultKey: base64.StdEncoding.EncodeToString(membership.EncryptedVaultKey),
		})
	}
	serialized, err := json.Marshal(response)
	if err != nil || len(serialized) > int(httpapi.MaxRotationRequestBytes) {
		return writeAPIError(ctx, http.StatusConflict, "identity_rotation_unavailable")
	}
	return ctx.JSON(http.StatusOK, response)
}

type userEncryptionIdentityRotationSnapshotResponse struct {
	PublicKey           identityapp.UserEncryptionPublicKey                `json:"publicKey"`
	EncryptedPrivateKey string                                             `json:"encryptedPrivateKey"`
	EncryptionVersion   int                                                `json:"encryptionVersion"`
	Memberships         []userEncryptionIdentityRotationMembershipResponse `json:"memberships"`
}

type userEncryptionIdentityRotationMembershipResponse struct {
	VaultID           string `json:"vaultId"`
	KeyVersion        int    `json:"keyVersion"`
	EncryptedVaultKey string `json:"encryptedVaultKey"`
}

type userEncryptionIdentityRotationRequest struct {
	ExpectedPublicKey           map[string]json.RawMessage                    `json:"expectedPublicKey"`
	ExpectedEncryptedPrivateKey string                                        `json:"expectedEncryptedPrivateKey"`
	ExpectedEncryptionVersion   int                                           `json:"expectedEncryptionVersion"`
	PublicKey                   map[string]json.RawMessage                    `json:"publicKey"`
	EncryptedPrivateKey         string                                        `json:"encryptedPrivateKey"`
	EncryptionVersion           int                                           `json:"encryptionVersion"`
	Memberships                 []userEncryptionIdentityRotationMemberRequest `json:"memberships"`
}

type userEncryptionIdentityRotationMemberRequest struct {
	VaultID                   string `json:"vaultId"`
	ExpectedKeyVersion        int    `json:"expectedKeyVersion"`
	ExpectedEncryptedVaultKey string `json:"expectedEncryptedVaultKey"`
	EncryptedVaultKey         string `json:"encryptedVaultKey"`
}

func (handlers *Handlers) patchUserEncryptionIdentityRotation(ctx *echo.Context) error {
	user, authorized, err := handlers.authorizeApplicationRequest(ctx, "key_material_mutation")
	if err != nil || !authorized {
		return err
	}
	if handlers.dependencies.EncryptionIdentityRotation == nil {
		return errors.New("user encryption identity rotation service is unavailable")
	}
	request, err := httpapi.DecodeJSONBody[userEncryptionIdentityRotationRequest](ctx.Request(), httpapi.MaxRotationRequestBytes)
	if err != nil || request.ExpectedEncryptionVersion != 1 || request.EncryptionVersion != 1 || request.Memberships == nil ||
		len(request.Memberships) > httpapi.MaxRotationMemberPackages {
		return writeAPIError(ctx, http.StatusBadRequest, "invalid_identity_rotation")
	}
	expectedPublicKey, err := parseRequestPublicEncryptionKey(request.ExpectedPublicKey)
	if err != nil {
		return writeAPIError(ctx, http.StatusBadRequest, "invalid_identity_rotation")
	}
	publicKey, err := parseRequestPublicEncryptionKey(request.PublicKey)
	if err != nil {
		return writeAPIError(ctx, http.StatusBadRequest, "invalid_identity_rotation")
	}
	expectedPrivateKey, err := httpapi.DecodeBoundedBase64(request.ExpectedEncryptedPrivateKey, 13, httpapi.MaxEncryptedBlobBytes)
	if err != nil {
		return writeAPIError(ctx, http.StatusBadRequest, "invalid_identity_rotation")
	}
	rotation := identityapp.UserEncryptionIdentityRotation{
		ExpectedPublicKey: expectedPublicKey, ExpectedEncryptedPrivateKey: expectedPrivateKey,
		ExpectedEncryptionVersion: request.ExpectedEncryptionVersion, PublicKey: publicKey,
		EncryptionVersion: request.EncryptionVersion, Memberships: make([]identityapp.UserEncryptionIdentityRotationMembership, 0, len(request.Memberships)),
	}
	defer clearUserEncryptionIdentityRotation(&rotation)
	rotation.EncryptedPrivateKey, err = httpapi.DecodeBoundedBase64(request.EncryptedPrivateKey, 13, httpapi.MaxEncryptedBlobBytes)
	if err != nil {
		return writeAPIError(ctx, http.StatusBadRequest, "invalid_identity_rotation")
	}
	seenVaultIDs := make(map[string]struct{}, len(request.Memberships))
	for _, membership := range request.Memberships {
		if !httpapi.ValidRouteParameter(membership.VaultID) || membership.ExpectedKeyVersion < 1 {
			return writeAPIError(ctx, http.StatusBadRequest, "invalid_identity_rotation")
		}
		if _, exists := seenVaultIDs[membership.VaultID]; exists {
			return writeAPIError(ctx, http.StatusBadRequest, "invalid_identity_rotation")
		}
		seenVaultIDs[membership.VaultID] = struct{}{}
		expectedVaultKey, decodeErr := httpapi.DecodeBoundedBase64(membership.ExpectedEncryptedVaultKey, 13, httpapi.MaxEncryptedBlobBytes)
		if decodeErr != nil {
			return writeAPIError(ctx, http.StatusBadRequest, "invalid_identity_rotation")
		}
		replacementVaultKey, decodeErr := httpapi.DecodeBoundedBase64(membership.EncryptedVaultKey, 13, httpapi.MaxEncryptedBlobBytes)
		if decodeErr != nil {
			clear(expectedVaultKey)
			return writeAPIError(ctx, http.StatusBadRequest, "invalid_identity_rotation")
		}
		rotation.Memberships = append(rotation.Memberships, identityapp.UserEncryptionIdentityRotationMembership{
			VaultID: membership.VaultID, ExpectedKeyVersion: membership.ExpectedKeyVersion,
			ExpectedVaultKey: expectedVaultKey, ReplacementVaultKey: replacementVaultKey,
		})
	}
	rotated, err := handlers.dependencies.EncryptionIdentityRotation.Rotate(ctx.Request().Context(), user.ID, rotation)
	if err != nil {
		return err
	}
	if !rotated {
		return writeAPIError(ctx, http.StatusConflict, "identity_rotation_rejected")
	}
	return ctx.NoContent(http.StatusNoContent)
}

func parseRequestPublicEncryptionKey(fields map[string]json.RawMessage) (identityapp.UserEncryptionPublicKey, error) {
	serialized, err := json.Marshal(fields)
	if err != nil {
		return identityapp.UserEncryptionPublicKey{}, errors.New("public encryption key is invalid")
	}
	return identityapp.ParseUserEncryptionPublicKey(serialized)
}

func validCanonicalSHA256Digest(value string) bool {
	decoded, err := base64.RawURLEncoding.Strict().DecodeString(value)
	if err != nil || len(decoded) != 32 || base64.RawURLEncoding.EncodeToString(decoded) != value {
		clear(decoded)
		return false
	}
	clear(decoded)
	return true
}

func clearUserEncryptionIdentityRotation(rotation *identityapp.UserEncryptionIdentityRotation) {
	clear(rotation.ExpectedEncryptedPrivateKey)
	clear(rotation.EncryptedPrivateKey)
	for index := range rotation.Memberships {
		clear(rotation.Memberships[index].ExpectedVaultKey)
		clear(rotation.Memberships[index].ReplacementVaultKey)
	}
}

func clearUserEncryptionIdentityRotationSnapshot(snapshot *identityapp.UserEncryptionIdentityRotationSnapshot) {
	clear(snapshot.EncryptedPrivateKey)
	for index := range snapshot.Memberships {
		clear(snapshot.Memberships[index].EncryptedVaultKey)
	}
}
