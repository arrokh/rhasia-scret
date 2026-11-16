package repository

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	apiEntity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity"
	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
)

const (
	onlineWorkspaceBundleSchemaVersion   = 2
	personalOfflineSnapshotSchemaVersion = 3
	authorizedWorkspaceResponseVersion   = 1
	offlineEncryptionVersion             = 1
)

type WorkspaceBundleReader struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewWorkspaceBundleReader(pool *pgxpool.Pool, now func() time.Time) (*WorkspaceBundleReader, error) {
	if pool == nil {
		return nil, errors.New("workspace bundle reader is not configured")
	}
	if now == nil {
		now = time.Now
	}
	return &WorkspaceBundleReader{pool: pool, now: now}, nil
}

type cryptoProfileRow struct {
	vaultUnlockSalt           []byte
	wrappedUserRootKey        []byte
	rootKeyWrappingVersion    int32
	encryptedPersonalVaultKey []byte
	userEncryptionPublicKey   []byte
	encryptedUserPrivateKey   []byte
	userEncryptionKeyVersion  pgtype.Int4
}

type vaultRow struct {
	id                string
	name              []byte
	encryptionVersion int32
}

type membershipRow struct {
	vaultID                string
	role                   string
	name                   []byte
	vaultEncryptionVersion int32
	encryptedVaultKey      []byte
	keyVersion             pgtype.Int4
	membersCanAdd          bool
	membersCanEdit         bool
	membersCanDelete       bool
	canAddOverride         pgtype.Bool
	canEditOverride        pgtype.Bool
	canDeleteOverride      pgtype.Bool
}

func (reader *WorkspaceBundleReader) ReadOnlineWorkspaceBundle(ctx context.Context, userID string) (*apiEntity.EncryptedOnlineWorkspaceBundle, error) {
	snapshot, err := reader.readSnapshot(ctx, userID)
	if err != nil || snapshot == nil {
		return nil, err
	}
	return &snapshot.bundle, nil
}

func (reader *WorkspaceBundleReader) ReadAuthorizedWorkspaceResponse(ctx context.Context, userID string) (*apiEntity.AuthorizedWorkspaceResponse, error) {
	snapshot, err := reader.readSnapshot(ctx, userID)
	if err != nil || snapshot == nil {
		return nil, err
	}
	bundle := snapshot.bundle
	personalContent := personalSnapshotContent{
		SchemaVersion:  personalOfflineSnapshotSchemaVersion,
		ProfileID:      bundle.ProfileID,
		SynchronizedAt: bundle.SynchronizedAt,
		CryptoProfile:  bundle.CryptoProfile,
		PersonalVault:  bundle.PersonalVault,
	}
	personalToken, err := synchronizationToken(personalContent)
	if err != nil {
		return nil, fmt.Errorf("encode Personal offline snapshot token: %w", err)
	}
	personalSnapshot := apiEntity.EncryptedPersonalOfflineSnapshot{
		SchemaVersion:        personalContent.SchemaVersion,
		ProfileID:            personalContent.ProfileID,
		SynchronizedAt:       personalContent.SynchronizedAt,
		SynchronizationToken: personalToken,
		CryptoProfile:        personalContent.CryptoProfile,
		PersonalVault:        personalContent.PersonalVault,
	}
	userIdentity, err := readEncryptedUserIdentity(snapshot.profile)
	if err != nil {
		return nil, err
	}
	workspaceToken, err := synchronizationToken(workspaceTokenContent{
		SynchronizationToken:   bundle.SynchronizationToken,
		UserEncryptionIdentity: userIdentity,
	})
	if err != nil {
		return nil, fmt.Errorf("encode workspace synchronization token: %w", err)
	}
	return &apiEntity.AuthorizedWorkspaceResponse{
		ResponseVersion:               authorizedWorkspaceResponseVersion,
		WorkspaceSynchronizationToken: workspaceToken,
		SynchronizedAt:                bundle.SynchronizedAt,
		PersonalSnapshot:              personalSnapshot,
		SharedVaults:                  bundle.SharedVaults,
		UserEncryptionIdentity:        userIdentity,
	}, nil
}

type authorizedBundleSnapshot struct {
	bundle  apiEntity.EncryptedOnlineWorkspaceBundle
	profile cryptoProfileRow
}

func (reader *WorkspaceBundleReader) readSnapshot(ctx context.Context, userID string) (*authorizedBundleSnapshot, error) {
	if userID == "" {
		return nil, nil
	}
	transaction, err := reader.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, fmt.Errorf("begin offline workspace snapshot: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	profile, found, err := readCryptoProfile(ctx, transaction, userID)
	if err != nil {
		return nil, err
	}
	if !found {
		if err := transaction.Commit(ctx); err != nil {
			return nil, fmt.Errorf("finish uninitialized workspace read: %w", err)
		}
		return nil, nil
	}
	personal, found, err := readPersonalVault(ctx, transaction, userID)
	if err != nil {
		return nil, err
	}
	if !found || personal.name == nil {
		if err := transaction.Commit(ctx); err != nil {
			return nil, fmt.Errorf("finish uninitialized Personal Vault read: %w", err)
		}
		return nil, nil
	}
	if profile.rootKeyWrappingVersion != offlineEncryptionVersion {
		return nil, errors.New("User Crypto Profile has unsupported offline encryption version")
	}
	if len(profile.vaultUnlockSalt) != 16 || validateEncryptedEnvelope(profile.wrappedUserRootKey) != nil ||
		validateEncryptedEnvelope(profile.encryptedPersonalVaultKey) != nil {
		return nil, errors.New("User Crypto Profile contains an invalid encrypted offline bundle")
	}
	if err := apiEntity.ValidateOpaqueIdentifier(userID); err != nil {
		return nil, err
	}
	if err := validateVaultRow(personal); err != nil {
		return nil, err
	}
	if personal.id == userID {
		return nil, errors.New("Personal Vault identifier must differ from profile identifier")
	}
	personalAccounts, err := readAccounts(ctx, transaction, personal.id)
	if err != nil {
		return nil, err
	}
	personalVault := apiEntity.EncryptedOfflinePersonalVault{
		VaultID: personal.id, Lifecycle: "ACTIVE", EncryptedName: base64.StdEncoding.EncodeToString(personal.name),
		EncryptionVersion: int(personal.encryptionVersion), Accounts: personalAccounts,
	}
	memberships, err := readActiveSharedMemberships(ctx, transaction, userID)
	if err != nil {
		return nil, err
	}
	sharedVaults := make([]apiEntity.EncryptedOnlineSharedVault, 0, len(memberships))
	for _, membership := range memberships {
		if membership.name == nil || membership.encryptedVaultKey == nil || !membership.keyVersion.Valid || membership.keyVersion.Int32 == 0 {
			continue
		}
		if membership.role != string(apiEntity.SharedVaultMemberRoleOwner) && membership.role != string(apiEntity.SharedVaultMemberRoleViewer) {
			continue
		}
		if membership.keyVersion.Int32 < 0 {
			return nil, errors.New("Shared Vault membership has an invalid key version")
		}
		if err := validateVaultRow(vaultRow{id: membership.vaultID, name: membership.name, encryptionVersion: membership.vaultEncryptionVersion}); err != nil {
			return nil, err
		}
		if err := validateKeyPackage(membership.encryptedVaultKey); err != nil {
			return nil, err
		}
		accounts, err := readAccounts(ctx, transaction, membership.vaultID)
		if err != nil {
			return nil, err
		}
		role, _ := apiEntity.ParseSharedVaultMemberRole(membership.role)
		permissions := apiEntity.EffectiveSharedVaultAccountPermissionsFor(role,
			apiEntity.SharedVaultAccountPermissions{
				CanAddAccounts: membership.membersCanAdd, CanEditAccounts: membership.membersCanEdit,
				CanDeleteAccounts: membership.membersCanDelete,
			}, apiEntity.SharedVaultAccountPermissionOverrides{
				CanAddAccounts:    nullablePermission(membership.canAddOverride),
				CanEditAccounts:   nullablePermission(membership.canEditOverride),
				CanDeleteAccounts: nullablePermission(membership.canDeleteOverride),
			})
		sharedVaults = append(sharedVaults, apiEntity.EncryptedOnlineSharedVault{
			VaultID: membership.vaultID, Lifecycle: "ACTIVE", Role: membership.role,
			EffectiveAccountPermissions: permissions,
			EncryptedName:               base64.StdEncoding.EncodeToString(membership.name),
			EncryptionVersion:           int(membership.vaultEncryptionVersion),
			EncryptedVaultKey:           base64.StdEncoding.EncodeToString(membership.encryptedVaultKey),
			KeyVersion:                  int64(membership.keyVersion.Int32), Accounts: accounts,
		})
	}
	synchronizedAt := reader.now().UTC().Format("2006-01-02T15:04:05.000Z")
	content := workspaceBundleContent{
		SchemaVersion: onlineWorkspaceBundleSchemaVersion,
		ProfileID:     userID,
		CryptoProfile: apiEntity.EncryptedOfflineCryptoProfile{
			VaultUnlockSalt:           base64.StdEncoding.EncodeToString(profile.vaultUnlockSalt),
			WrappedUserRootKey:        base64.StdEncoding.EncodeToString(profile.wrappedUserRootKey),
			EncryptedPersonalVaultKey: base64.StdEncoding.EncodeToString(profile.encryptedPersonalVaultKey),
			EncryptionVersion:         int(profile.rootKeyWrappingVersion),
		},
		PersonalVault: personalVault,
		SharedVaults:  sharedVaults,
	}
	bundleToken, err := synchronizationToken(content)
	if err != nil {
		return nil, fmt.Errorf("encode online workspace bundle token: %w", err)
	}
	bundle := apiEntity.EncryptedOnlineWorkspaceBundle{
		SchemaVersion:        content.SchemaVersion,
		ProfileID:            content.ProfileID,
		SynchronizedAt:       synchronizedAt,
		SynchronizationToken: bundleToken,
		CryptoProfile:        content.CryptoProfile,
		PersonalVault:        content.PersonalVault,
		SharedVaults:         content.SharedVaults,
	}
	if err := transaction.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit offline workspace snapshot: %w", err)
	}
	return &authorizedBundleSnapshot{bundle: bundle, profile: profile}, nil
}

func readCryptoProfile(ctx context.Context, queryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, userID string) (cryptoProfileRow, bool, error) {
	var profile cryptoProfileRow
	err := queryer.QueryRow(ctx, `
		SELECT vault_unlock_salt, wrapped_user_root_key, root_key_wrapping_version,
		       encrypted_personal_vault_key, user_encryption_public_key::text,
		       encrypted_user_private_key, user_encryption_key_version
		FROM user_crypto_profiles WHERE user_id = $1`, userID).Scan(
		&profile.vaultUnlockSalt, &profile.wrappedUserRootKey, &profile.rootKeyWrappingVersion,
		&profile.encryptedPersonalVaultKey, &profile.userEncryptionPublicKey,
		&profile.encryptedUserPrivateKey, &profile.userEncryptionKeyVersion,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return cryptoProfileRow{}, false, nil
	}
	if err != nil {
		return cryptoProfileRow{}, false, fmt.Errorf("read User Crypto Profile for offline bundle: %w", err)
	}
	return profile, true, nil
}

func readPersonalVault(ctx context.Context, queryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, ownerID string) (vaultRow, bool, error) {
	var vault vaultRow
	err := queryer.QueryRow(ctx, `
		SELECT id, encrypted_name, encryption_version
		FROM vaults
		WHERE owner_id = $1 AND type = 'PERSONAL' AND lifecycle = 'ACTIVE' AND deleted_at IS NULL
		ORDER BY created_at ASC, id ASC LIMIT 1`, ownerID).Scan(&vault.id, &vault.name, &vault.encryptionVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return vaultRow{}, false, nil
	}
	if err != nil {
		return vaultRow{}, false, fmt.Errorf("read active Personal Vault for offline bundle: %w", err)
	}
	return vault, true, nil
}

func readAccounts(ctx context.Context, queryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, vaultID string) ([]apiEntity.EncryptedOfflineAccount, error) {
	rows, err := queryer.Query(ctx, `
		SELECT id, encrypted_payload, encryption_version, revision
		FROM authenticator_accounts
		WHERE vault_id = $1 AND deleted_at IS NULL
		ORDER BY created_at ASC, id ASC`, vaultID)
	if err != nil {
		return nil, fmt.Errorf("read active Vault accounts for offline bundle: %w", err)
	}
	defer rows.Close()
	accounts := make([]apiEntity.EncryptedOfflineAccount, 0)
	seen := make(map[string]struct{})
	for rows.Next() {
		var id string
		var payload []byte
		var encryptionVersion int32
		var revision int32
		if err := rows.Scan(&id, &payload, &encryptionVersion, &revision); err != nil {
			return nil, fmt.Errorf("scan offline Vault account: %w", err)
		}
		if apiEntity.ValidateOpaqueIdentifier(id) != nil || encryptionVersion != offlineEncryptionVersion || revision < 1 || validateEncryptedEnvelope(payload) != nil {
			return nil, errors.New("active Vault contains an invalid encrypted offline account")
		}
		if _, exists := seen[id]; exists {
			return nil, errors.New("active Vault contains duplicate account identifiers")
		}
		seen[id] = struct{}{}
		accounts = append(accounts, apiEntity.EncryptedOfflineAccount{
			ID: id, EncryptedPayload: base64.StdEncoding.EncodeToString(payload),
			EncryptionVersion: int(encryptionVersion), Revision: int64(revision),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate active Vault accounts for offline bundle: %w", err)
	}
	return accounts, nil
}

func readActiveSharedMemberships(ctx context.Context, queryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, userID string) ([]membershipRow, error) {
	rows, err := queryer.Query(ctx, `
		SELECT vault.id, membership.role, vault.encrypted_name, vault.encryption_version,
		       membership.encrypted_vault_key, membership.key_version,
		       vault.members_can_add_accounts, vault.members_can_edit_accounts, vault.members_can_delete_accounts,
		       membership.can_add_accounts_override, membership.can_edit_accounts_override,
		       membership.can_delete_accounts_override
		FROM vault_members AS membership
		JOIN vaults AS vault ON vault.id = membership.vault_id
		WHERE membership.user_id = $1 AND membership.status = 'ACTIVE'
		  AND vault.type = 'SHARED' AND vault.lifecycle = 'ACTIVE' AND vault.deleted_at IS NULL
		ORDER BY membership.created_at ASC, membership.vault_id ASC`, userID)
	if err != nil {
		return nil, fmt.Errorf("read active Shared Vault memberships for offline bundle: %w", err)
	}
	defer rows.Close()
	memberships := make([]membershipRow, 0)
	for rows.Next() {
		var row membershipRow
		if err := rows.Scan(&row.vaultID, &row.role, &row.name, &row.vaultEncryptionVersion,
			&row.encryptedVaultKey, &row.keyVersion, &row.membersCanAdd, &row.membersCanEdit, &row.membersCanDelete,
			&row.canAddOverride, &row.canEditOverride, &row.canDeleteOverride); err != nil {
			return nil, fmt.Errorf("scan active Shared Vault membership for offline bundle: %w", err)
		}
		memberships = append(memberships, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate active Shared Vault memberships for offline bundle: %w", err)
	}
	return memberships, nil
}

func readEncryptedUserIdentity(profile cryptoProfileRow) (*apiEntity.EncryptedUserEncryptionIdentity, error) {
	if len(profile.userEncryptionPublicKey) == 0 || profile.encryptedUserPrivateKey == nil ||
		!profile.userEncryptionKeyVersion.Valid || profile.userEncryptionKeyVersion.Int32 != 1 {
		return nil, nil
	}
	if bytes.Equal(bytes.TrimSpace(profile.userEncryptionPublicKey), []byte("null")) {
		return nil, nil
	}
	if _, err := apiService.ParseUserEncryptionPublicKey(profile.userEncryptionPublicKey); err != nil {
		return nil, fmt.Errorf("User Encryption identity public key is invalid: %w", err)
	}
	if validateEncryptedEnvelope(profile.encryptedUserPrivateKey) != nil {
		return nil, errors.New("User Encryption identity private-key envelope is invalid")
	}
	return &apiEntity.EncryptedUserEncryptionIdentity{
		PublicKey:           append(json.RawMessage(nil), profile.userEncryptionPublicKey...),
		EncryptedPrivateKey: base64.StdEncoding.EncodeToString(profile.encryptedUserPrivateKey),
		EncryptionVersion:   offlineEncryptionVersion,
	}, nil
}

func validateVaultRow(vault vaultRow) error {
	if apiEntity.ValidateOpaqueIdentifier(vault.id) != nil || vault.encryptionVersion != offlineEncryptionVersion ||
		validateEncryptedEnvelope(vault.name) != nil {
		return errors.New("active Vault contains invalid encrypted offline data")
	}
	return nil
}

func validateEncryptedEnvelope(value []byte) error {
	if len(value) < 29 || (value[0] != 1 && value[0] != 2) {
		return errors.New("encrypted envelope is invalid")
	}
	return nil
}

func validateKeyPackage(value []byte) error {
	if len(value) < 29 || len(value) > 32_768 {
		return errors.New("encrypted key package has an invalid size")
	}
	if value[0] == 1 || value[0] == 2 {
		return nil
	}
	if value[0] != '{' {
		return errors.New("encrypted key package has an unsupported format")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(value, &fields); err != nil || len(fields) != 4 {
		return errors.New("encrypted key package is invalid")
	}
	for field := range fields {
		switch field {
		case "version", "nonce", "ciphertext", "ephemeralPublicKey":
		default:
			return errors.New("encrypted key package is invalid")
		}
	}
	var version int
	var nonce, ciphertext string
	if json.Unmarshal(fields["version"], &version) != nil || (version != 1 && version != 2) ||
		json.Unmarshal(fields["nonce"], &nonce) != nil || json.Unmarshal(fields["ciphertext"], &ciphertext) != nil {
		return errors.New("encrypted key package is invalid")
	}
	decodedNonce, err := base64.StdEncoding.Strict().DecodeString(nonce)
	if err != nil || base64.StdEncoding.EncodeToString(decodedNonce) != nonce || len(decodedNonce) != 12 {
		clear(decodedNonce)
		return errors.New("encrypted key package is invalid")
	}
	clear(decodedNonce)
	decodedCiphertext, err := base64.StdEncoding.Strict().DecodeString(ciphertext)
	if err != nil || base64.StdEncoding.EncodeToString(decodedCiphertext) != ciphertext || len(decodedCiphertext) < 16 {
		clear(decodedCiphertext)
		return errors.New("encrypted key package is invalid")
	}
	clear(decodedCiphertext)
	if _, err := apiService.ParseUserEncryptionPublicKey(fields["ephemeralPublicKey"]); err != nil {
		return errors.New("encrypted key package is invalid")
	}
	return nil
}

func nullablePermission(value pgtype.Bool) *bool {
	if !value.Valid {
		return nil
	}
	permission := value.Bool
	return &permission
}

type workspaceBundleContent struct {
	SchemaVersion int                                     `json:"schemaVersion"`
	ProfileID     string                                  `json:"profileId"`
	CryptoProfile apiEntity.EncryptedOfflineCryptoProfile `json:"cryptoProfile"`
	PersonalVault apiEntity.EncryptedOfflinePersonalVault `json:"personalVault"`
	SharedVaults  []apiEntity.EncryptedOnlineSharedVault  `json:"sharedVaults"`
}

type personalSnapshotContent struct {
	SchemaVersion  int                                     `json:"schemaVersion"`
	ProfileID      string                                  `json:"profileId"`
	SynchronizedAt string                                  `json:"synchronizedAt"`
	CryptoProfile  apiEntity.EncryptedOfflineCryptoProfile `json:"cryptoProfile"`
	PersonalVault  apiEntity.EncryptedOfflinePersonalVault `json:"personalVault"`
}

type workspaceTokenContent struct {
	SynchronizationToken   string                                     `json:"synchronizationToken"`
	UserEncryptionIdentity *apiEntity.EncryptedUserEncryptionIdentity `json:"userEncryptionIdentity,omitempty"`
}

func synchronizationToken(value any) (string, error) {
	var output bytes.Buffer
	encoder := json.NewEncoder(&output)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return "", err
	}
	serialized := bytes.TrimSuffix(output.Bytes(), []byte("\n"))
	serialized = unescapeJavaScriptLineSeparators(serialized)
	digest := sha256.Sum256(serialized)
	return base64.RawURLEncoding.EncodeToString(digest[:]), nil
}

func unescapeJavaScriptLineSeparators(serialized []byte) []byte {
	result := make([]byte, 0, len(serialized))
	for index := 0; index < len(serialized); {
		if index+6 <= len(serialized) && serialized[index] == '\\' && serialized[index+1] == 'u' &&
			serialized[index+2] == '2' && serialized[index+3] == '0' && serialized[index+4] == '2' &&
			(serialized[index+5] == '8' || serialized[index+5] == '9') {
			backslashes := 0
			for previous := index - 1; previous >= 0 && serialized[previous] == '\\'; previous-- {
				backslashes++
			}
			if backslashes%2 == 0 {
				if serialized[index+5] == '8' {
					result = append(result, []byte("\u2028")...)
				} else {
					result = append(result, []byte("\u2029")...)
				}
				index += 6
				continue
			}
		}
		result = append(result, serialized[index])
		index++
	}
	return result
}

var _ apiService.WorkspaceBundleReader = (*WorkspaceBundleReader)(nil)
