package handler

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"regexp"
	"strconv"

	"github.com/labstack/echo/v5"

	apiEntity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
)

var (
	archiveImportUUIDPattern   = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	archiveImportBase64Pattern = regexp.MustCompile(`^(?:[A-Za-z0-9+/]{4})*(?:(?:[A-Za-z0-9+/]{2}==)|(?:[A-Za-z0-9+/]{3}=))?$`)
)

type EncryptedVaultImportHandlers struct {
	authorizer httpapi.ApplicationRequestAuthorizer
	imports    apiService.EncryptedVaultImportRepository
}

func NewEncryptedVaultImportHandlers(
	authorizer httpapi.ApplicationRequestAuthorizer,
	imports apiService.EncryptedVaultImportRepository,
) *EncryptedVaultImportHandlers {
	return &EncryptedVaultImportHandlers{authorizer: authorizer, imports: imports}
}

func (handlers *EncryptedVaultImportHandlers) OperationHandlers() map[string]httpapi.OperationHandler {
	return map[string]httpapi.OperationHandler{"postVaultimports": handlers.importArchive}
}

type archiveImportBody struct {
	Destination json.RawMessage `json:"destination"`
	Accounts    json.RawMessage `json:"accounts"`
}

type archiveImportResponse struct {
	VaultID      string   `json:"vaultId"`
	AccountIDs   []string `json:"accountIds"`
	VaultCreated bool     `json:"vaultCreated"`
	Replayed     bool     `json:"replayed"`
}

func (handlers *EncryptedVaultImportHandlers) importArchive(ctx *echo.Context) error {
	if handlers.authorizer == nil {
		return errors.New("archive import authorizer is not configured")
	}
	actorUserID, authorized, err := handlers.authorizer.AuthorizeApplicationRequest(ctx, "archive_import")
	if err != nil || !authorized {
		return err
	}
	if actorUserID == "" {
		return errors.New("archive import authorizer returned an empty Application User ID")
	}
	contentLength, err := parseArchiveImportContentLength(ctx.Request())
	if err != nil {
		return archiveImportError(ctx, http.StatusBadRequest, "invalid_archive_import")
	}
	if contentLength > apiEntity.MaxVaultArchiveImportRequestBytes {
		return archiveImportError(ctx, http.StatusRequestEntityTooLarge, "archive_import_too_large")
	}
	body, err := httpapi.DecodeJSONBody[archiveImportBody](ctx.Request(), apiEntity.MaxVaultArchiveImportRequestBytes)
	if errors.Is(err, httpapi.ErrJSONBodyTooLarge) {
		return archiveImportError(ctx, http.StatusRequestEntityTooLarge, "archive_import_too_large")
	}
	if err != nil {
		return archiveImportError(ctx, http.StatusBadRequest, "invalid_archive_import")
	}
	defer clear(body.Destination)
	defer clear(body.Accounts)
	request, err := parseEncryptedVaultImport(body)
	if err != nil {
		return archiveImportError(ctx, http.StatusBadRequest, "invalid_archive_import")
	}
	defer clearEncryptedVaultImport(&request)
	result, err := apiService.ImportEncryptedVaultArchive(ctx.Request().Context(), actorUserID, request, handlers.imports)
	if err != nil {
		return err
	}
	switch result.Status {
	case apiEntity.ImportStatusDestinationUnavailable:
		return archiveImportError(ctx, http.StatusNotFound, "destination_unavailable")
	case apiEntity.ImportStatusConflict:
		return archiveImportError(ctx, http.StatusConflict, "archive_import_conflict")
	case apiEntity.ImportStatusImported, apiEntity.ImportStatusReplayed:
		status := http.StatusOK
		if result.Status == apiEntity.ImportStatusImported {
			status = http.StatusCreated
		}
		ctx.Response().Header().Set(echo.HeaderCacheControl, "no-store")
		return ctx.JSON(status, archiveImportResponse{
			VaultID: result.VaultID, AccountIDs: result.AccountIDs,
			VaultCreated: result.VaultCreated, Replayed: result.Status == apiEntity.ImportStatusReplayed,
		})
	default:
		return errors.New("archive import returned an unsupported status")
	}
}

func archiveImportError(ctx *echo.Context, status int, code string) error {
	ctx.Response().Header().Set(echo.HeaderCacheControl, "no-store")
	return ctx.JSON(status, httpapi.ApiError{Error: code})
}

func parseArchiveImportContentLength(request *http.Request) (int64, error) {
	values := request.Header.Values("Content-Length")
	if len(values) > 1 {
		return 0, httpapi.ErrInvalidJSONBody
	}
	value := "0"
	if len(values) == 1 {
		value = values[0]
	} else if request.ContentLength >= 0 {
		value = strconv.FormatInt(request.ContentLength, 10)
	}
	if value == "" {
		return 0, httpapi.ErrInvalidJSONBody
	}
	for _, digit := range value {
		if digit < '0' || digit > '9' {
			return 0, httpapi.ErrInvalidJSONBody
		}
	}
	length, err := strconv.ParseInt(value, 10, 64)
	if err != nil || length > httpapi.MaxSafeJavaScriptInteger {
		return 0, httpapi.ErrInvalidJSONBody
	}
	return length, nil
}

func parseEncryptedVaultImport(body archiveImportBody) (apiEntity.EncryptedVaultImport, error) {
	var request apiEntity.EncryptedVaultImport
	if body.Destination == nil || body.Accounts == nil {
		return request, httpapi.ErrInvalidJSONBody
	}
	destination, err := parseArchiveDestination(body.Destination)
	if err != nil {
		return request, err
	}
	request.Destination = destination
	trimmedAccounts := bytes.TrimSpace(body.Accounts)
	if len(trimmedAccounts) == 0 || trimmedAccounts[0] != '[' {
		return request, httpapi.ErrInvalidJSONBody
	}
	var accountValues []json.RawMessage
	if err := json.Unmarshal(body.Accounts, &accountValues); err != nil || len(accountValues) > apiEntity.MaxVaultArchiveImportAccounts {
		return request, httpapi.ErrInvalidJSONBody
	}
	request.Accounts = make([]apiEntity.EncryptedImportedAccount, 0, len(accountValues))
	complete := false
	defer func() {
		if !complete {
			clearEncryptedVaultImport(&request)
		}
	}()
	for _, accountValue := range accountValues {
		account, err := parseImportedAccount(accountValue)
		if err != nil {
			return request, err
		}
		request.Accounts = append(request.Accounts, account)
	}
	if apiEntity.HasDuplicateImportedAccountIDs(request.Accounts) {
		return request, httpapi.ErrInvalidJSONBody
	}
	if err := apiEntity.ValidateEncryptedVaultImport(request); err != nil {
		return request, err
	}
	complete = true
	return request, nil
}

func parseArchiveDestination(raw json.RawMessage) (apiEntity.Destination, error) {
	fields, err := strictArchiveObject(raw, "kind", "vaultId", "vaultType", "expectedKeyVersion", "encryptedName", "encryptedOwnerVaultKey", "expectedOwnerPublicKey", "encryptionVersion")
	if err != nil {
		return apiEntity.Destination{}, err
	}
	var kind string
	if err := json.Unmarshal(fields["kind"], &kind); err != nil {
		return apiEntity.Destination{}, httpapi.ErrInvalidJSONBody
	}
	switch apiEntity.DestinationKind(kind) {
	case apiEntity.DestinationExisting:
		var vaultID, vaultType string
		if err := json.Unmarshal(fields["vaultId"], &vaultID); err != nil || !httpapi.ValidStringLength(vaultID, 1, httpapi.MaxRouteParameterLength) {
			return apiEntity.Destination{}, httpapi.ErrInvalidJSONBody
		}
		if err := json.Unmarshal(fields["vaultType"], &vaultType); err != nil {
			return apiEntity.Destination{}, httpapi.ErrInvalidJSONBody
		}
		destination := apiEntity.Destination{
			Kind:     apiEntity.DestinationExisting,
			Existing: apiEntity.ExistingVaultDestination{VaultID: vaultID, VaultType: vaultType},
		}
		switch vaultType {
		case "PERSONAL":
			if err := requireArchiveFields(fields, "kind", "vaultId", "vaultType"); err != nil {
				return apiEntity.Destination{}, err
			}
		case "SHARED":
			if err := requireArchiveFields(fields, "kind", "vaultId", "vaultType", "expectedKeyVersion"); err != nil {
				return apiEntity.Destination{}, err
			}
			var expectedKeyVersion httpapi.PositiveSafeInteger
			if err := json.Unmarshal(fields["expectedKeyVersion"], &expectedKeyVersion); err != nil {
				return apiEntity.Destination{}, httpapi.ErrInvalidJSONBody
			}
			value := int64(expectedKeyVersion)
			destination.Existing.ExpectedKeyVersion = &value
		default:
			return apiEntity.Destination{}, httpapi.ErrInvalidJSONBody
		}
		return destination, nil
	case apiEntity.DestinationNewShared:
		if err := requireArchiveFields(fields, "kind", "vaultId", "encryptedName", "encryptedOwnerVaultKey", "expectedOwnerPublicKey", "encryptionVersion"); err != nil {
			return apiEntity.Destination{}, err
		}
		var vaultID string
		if err := json.Unmarshal(fields["vaultId"], &vaultID); err != nil || !archiveImportUUIDPattern.MatchString(vaultID) {
			return apiEntity.Destination{}, httpapi.ErrInvalidJSONBody
		}
		encryptedName, err := decodeArchiveCiphertext(fields["encryptedName"], 1024)
		if err != nil {
			return apiEntity.Destination{}, err
		}
		encryptedOwnerVaultKey, err := decodeArchiveCiphertext(fields["encryptedOwnerVaultKey"], 1024)
		if err != nil {
			clear(encryptedName)
			return apiEntity.Destination{}, err
		}
		publicKey, err := parseExpectedOwnerPublicKey(fields["expectedOwnerPublicKey"])
		if err != nil {
			clear(encryptedName)
			clear(encryptedOwnerVaultKey)
			return apiEntity.Destination{}, err
		}
		version, err := parseArchiveEncryptionVersion(fields["encryptionVersion"])
		if err != nil {
			clear(encryptedName)
			clear(encryptedOwnerVaultKey)
			return apiEntity.Destination{}, err
		}
		return apiEntity.Destination{
			Kind: apiEntity.DestinationNewShared,
			NewShared: apiEntity.NewSharedVaultDestination{
				VaultID: vaultID, EncryptedName: encryptedName, EncryptedOwnerVaultKey: encryptedOwnerVaultKey,
				ExpectedOwnerPublicKey: publicKey, EncryptionVersion: version,
			},
		}, nil
	default:
		return apiEntity.Destination{}, httpapi.ErrInvalidJSONBody
	}
}

func parseImportedAccount(raw json.RawMessage) (apiEntity.EncryptedImportedAccount, error) {
	fields, err := strictArchiveObject(raw, "id", "encryptedPayload", "encryptionVersion")
	if err != nil {
		return apiEntity.EncryptedImportedAccount{}, err
	}
	if err := requireArchiveFields(fields, "id", "encryptedPayload", "encryptionVersion"); err != nil {
		return apiEntity.EncryptedImportedAccount{}, err
	}
	var id string
	if err := json.Unmarshal(fields["id"], &id); err != nil || !archiveImportUUIDPattern.MatchString(id) {
		return apiEntity.EncryptedImportedAccount{}, httpapi.ErrInvalidJSONBody
	}
	payload, err := decodeArchiveCiphertext(fields["encryptedPayload"], apiEntity.MaxImportedCiphertextBytes)
	if err != nil {
		return apiEntity.EncryptedImportedAccount{}, err
	}
	version, err := parseArchiveEncryptionVersion(fields["encryptionVersion"])
	if err != nil {
		clear(payload)
		return apiEntity.EncryptedImportedAccount{}, err
	}
	return apiEntity.EncryptedImportedAccount{ID: id, EncryptedPayload: payload, EncryptionVersion: version}, nil
}

func decodeArchiveCiphertext(raw json.RawMessage, maximumBytes int) ([]byte, error) {
	var encoded string
	if err := json.Unmarshal(raw, &encoded); err != nil {
		return nil, httpapi.ErrInvalidJSONBody
	}
	if !archiveImportBase64Pattern.MatchString(encoded) {
		return nil, httpapi.ErrInvalidJSONBody
	}
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(decoded) < 29 || len(decoded) > maximumBytes || (decoded[0] != 1 && decoded[0] != 2) {
		clear(decoded)
		return nil, httpapi.ErrInvalidJSONBody
	}
	return decoded, nil
}

func parseExpectedOwnerPublicKey(raw json.RawMessage) (apiService.UserEncryptionPublicKey, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
		return apiService.UserEncryptionPublicKey{}, httpapi.ErrInvalidJSONBody
	}
	encoded, err := json.Marshal(fields)
	if err != nil {
		return apiService.UserEncryptionPublicKey{}, httpapi.ErrInvalidJSONBody
	}
	key, err := apiService.ParseUserEncryptionPublicKey(encoded)
	if err != nil {
		return apiService.UserEncryptionPublicKey{}, httpapi.ErrInvalidJSONBody
	}
	return key, nil
}

func parseArchiveEncryptionVersion(raw json.RawMessage) (int, error) {
	var version float64
	if err := json.Unmarshal(raw, &version); err != nil || math.IsNaN(version) || version != 1 {
		return 0, httpapi.ErrInvalidJSONBody
	}
	return 1, nil
}

func strictArchiveObject(raw json.RawMessage, allowedFields ...string) (map[string]json.RawMessage, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
		return nil, httpapi.ErrInvalidJSONBody
	}
	allowed := make(map[string]struct{}, len(allowedFields))
	for _, field := range allowedFields {
		allowed[field] = struct{}{}
	}
	for field := range fields {
		if _, ok := allowed[field]; !ok {
			return nil, httpapi.ErrInvalidJSONBody
		}
	}
	return fields, nil
}

func requireArchiveFields(fields map[string]json.RawMessage, names ...string) error {
	if len(fields) != len(names) {
		return httpapi.ErrInvalidJSONBody
	}
	for _, name := range names {
		if _, exists := fields[name]; !exists {
			return httpapi.ErrInvalidJSONBody
		}
	}
	return nil
}

func clearEncryptedVaultImport(request *apiEntity.EncryptedVaultImport) {
	if request == nil {
		return
	}
	clear(request.Destination.NewShared.EncryptedName)
	clear(request.Destination.NewShared.EncryptedOwnerVaultKey)
	for index := range request.Accounts {
		clear(request.Accounts[index].EncryptedPayload)
	}
}
