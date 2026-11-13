package infrastructure

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	membershipapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-membership/application"
	membershipdomain "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-membership/domain"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

type PostgresSharedVaultAccessRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresSharedVaultAccessRepository(pool *pgxpool.Pool) (*PostgresSharedVaultAccessRepository, error) {
	if pool == nil {
		return nil, errors.New("Shared Vault access repository is not configured")
	}
	return &PostgresSharedVaultAccessRepository{pool: pool}, nil
}

func (repository *PostgresSharedVaultAccessRepository) ListForMember(ctx context.Context, userID string) ([]membershipapp.SharedVaultAccess, error) {
	return repository.readAccess(ctx, userID, "")
}

func (repository *PostgresSharedVaultAccessRepository) GetForMember(ctx context.Context, userID string, vaultID string) (*membershipapp.SharedVaultAccess, error) {
	vaults, err := repository.readAccess(ctx, userID, vaultID)
	if err != nil {
		return nil, err
	}
	if len(vaults) == 0 {
		return nil, nil
	}
	return &vaults[0], nil
}

func (repository *PostgresSharedVaultAccessRepository) readAccess(
	ctx context.Context,
	userID string,
	vaultID string,
) ([]membershipapp.SharedVaultAccess, error) {
	rows, err := repository.pool.Query(ctx, `
		SELECT
			vault.id,
			member.role,
			vault.members_can_add_accounts,
			vault.members_can_edit_accounts,
			vault.members_can_delete_accounts,
			member.can_add_accounts_override,
			member.can_edit_accounts_override,
			member.can_delete_accounts_override,
			vault.encrypted_name,
			vault.encryption_version,
			member.encrypted_vault_key,
			member.key_version,
			account.id,
			account.encrypted_payload,
			account.encryption_version,
			account.revision
		FROM vault_members AS member
		JOIN vaults AS vault ON vault.id = member.vault_id
		LEFT JOIN authenticator_accounts AS account
			ON account.vault_id = vault.id AND account.deleted_at IS NULL
		WHERE member.user_id = $1
		  AND ($2 = '' OR vault.id = $2)
		  AND member.status = 'ACTIVE'
		  AND member.role IN ('OWNER', 'VIEWER')
		  AND member.encrypted_vault_key IS NOT NULL
		  AND member.key_version IS NOT NULL AND member.key_version <> 0
		  AND vault.type = 'SHARED'
		  AND vault.lifecycle = 'ACTIVE'
		  AND vault.deleted_at IS NULL
		  AND vault.encrypted_name IS NOT NULL
		ORDER BY member.created_at ASC, vault.id ASC, account.created_at ASC, account.id ASC`, userID, vaultID)
	if err != nil {
		return nil, fmt.Errorf("read Shared Vault access: %w", err)
	}
	defer rows.Close()

	vaults := make([]membershipapp.SharedVaultAccess, 0)
	indices := make(map[string]int)
	for rows.Next() {
		var currentVaultID string
		var roleValue string
		var defaultsAdd, defaultsEdit, defaultsDelete bool
		var overrideAdd, overrideEdit, overrideDelete pgtype.Bool
		var encryptedName, encryptedVaultKey []byte
		var encryptionVersion int32
		var keyVersion pgtype.Int4
		var accountID pgtype.Text
		var encryptedPayload []byte
		var accountEncryptionVersion, revision pgtype.Int4
		if err := rows.Scan(
			&currentVaultID,
			&roleValue,
			&defaultsAdd,
			&defaultsEdit,
			&defaultsDelete,
			&overrideAdd,
			&overrideEdit,
			&overrideDelete,
			&encryptedName,
			&encryptionVersion,
			&encryptedVaultKey,
			&keyVersion,
			&accountID,
			&encryptedPayload,
			&accountEncryptionVersion,
			&revision,
		); err != nil {
			clear(encryptedName)
			clear(encryptedVaultKey)
			clear(encryptedPayload)
			clearSharedVaultAccesses(vaults)
			return nil, fmt.Errorf("scan Shared Vault access: %w", err)
		}
		role, validRole := membershipdomain.ParseSharedVaultMemberRole(roleValue)
		if !validRole || !keyVersion.Valid {
			clear(encryptedName)
			clear(encryptedVaultKey)
			clear(encryptedPayload)
			clearSharedVaultAccesses(vaults)
			return nil, errors.New("Shared Vault access contains invalid membership metadata")
		}
		index, exists := indices[currentVaultID]
		if !exists {
			permissions := membershipdomain.EffectiveSharedVaultAccountPermissionsFor(
				role,
				membershipdomain.SharedVaultAccountPermissions{
					CanAddAccounts:    defaultsAdd,
					CanEditAccounts:   defaultsEdit,
					CanDeleteAccounts: defaultsDelete,
				},
				membershipdomain.SharedVaultAccountPermissionOverrides{
					CanAddAccounts:    nullableBool(overrideAdd),
					CanEditAccounts:   nullableBool(overrideEdit),
					CanDeleteAccounts: nullableBool(overrideDelete),
				},
			)
			index = len(vaults)
			indices[currentVaultID] = index
			vaults = append(vaults, membershipapp.SharedVaultAccess{
				VaultID:                     currentVaultID,
				Role:                        role,
				EffectiveAccountPermissions: permissions,
				EncryptedName:               copyAccessBytes(encryptedName),
				EncryptionVersion:           int(encryptionVersion),
				EncryptedVaultKey:           copyAccessBytes(encryptedVaultKey),
				KeyVersion:                  int64(keyVersion.Int32),
				Accounts:                    make([]membershipapp.SharedVaultAccountAccess, 0),
			})
		}
		clear(encryptedName)
		clear(encryptedVaultKey)
		if accountID.Valid {
			vaults[index].Accounts = append(vaults[index].Accounts, membershipapp.SharedVaultAccountAccess{
				ID:                accountID.String,
				EncryptedPayload:  copyAccessBytes(encryptedPayload),
				EncryptionVersion: int(accountEncryptionVersion.Int32),
				Revision:          int64(revision.Int32),
			})
		}
		clear(encryptedPayload)
	}
	if err := rows.Err(); err != nil {
		clearSharedVaultAccesses(vaults)
		return nil, fmt.Errorf("iterate Shared Vault access: %w", err)
	}
	return vaults, nil
}

func (repository *PostgresSharedVaultAccessRepository) MigrateKeyWrap(
	ctx context.Context,
	userID string,
	vaultID string,
	expectedKeyVersion int64,
	migration sharedapp.EncryptedPayloadMigration,
) (sharedapp.EncryptedPayloadMigrationResult, error) {
	if userID == "" || vaultID == "" || expectedKeyVersion < 1 {
		return sharedapp.EncryptedPayloadMigrationConflict, nil
	}
	replacement := copyAccessBytes(migration.ReplacementCiphertext)
	defer clear(replacement)
	migration.ReplacementCiphertext = replacement
	if !validKeyWrapMigration(migration) {
		return sharedapp.EncryptedPayloadMigrationConflict, nil
	}
	transaction, err := repository.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin Shared Vault key-wrap migration: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	var current []byte
	var keyVersion pgtype.Int4
	err = transaction.QueryRow(ctx, `
		SELECT member.encrypted_vault_key, member.key_version
		FROM vault_members AS member
		JOIN vaults AS vault ON vault.id = member.vault_id
		WHERE member.vault_id = $1 AND member.user_id = $2 AND member.status = 'ACTIVE'
		  AND member.role IN ('OWNER', 'VIEWER')
		  AND vault.type = 'SHARED' AND vault.lifecycle = 'ACTIVE' AND vault.deleted_at IS NULL
		FOR UPDATE OF member, vault`, vaultID, userID).Scan(&current, &keyVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return sharedapp.EncryptedPayloadMigrationConflict, nil
	}
	if err != nil {
		return "", fmt.Errorf("load Shared Vault key-wrap migration source: %w", err)
	}
	defer clear(current)
	if current == nil || !keyVersion.Valid || int64(keyVersion.Int32) != expectedKeyVersion {
		return sharedapp.EncryptedPayloadMigrationConflict, nil
	}
	currentDigest := sharedapp.SHA256Base64URL(current)
	if currentDigest == migration.ReplacementCiphertextDigest {
		if err := transaction.Commit(ctx); err != nil {
			return "", fmt.Errorf("commit Shared Vault key-wrap migration replay: %w", err)
		}
		return sharedapp.EncryptedPayloadMigrationAlreadyCommitted, nil
	}
	if currentDigest != migration.ExpectedCiphertextDigest || !isLegacyKeyWrapCiphertext(current) {
		return sharedapp.EncryptedPayloadMigrationConflict, nil
	}
	command, err := transaction.Exec(ctx, `
		UPDATE vault_members
		SET encrypted_vault_key = $1, updated_at = CURRENT_TIMESTAMP
		WHERE vault_id = $2 AND user_id = $3 AND status = 'ACTIVE'
		  AND key_version = $4 AND encrypted_vault_key = $5`,
		replacement, vaultID, userID, expectedKeyVersion, current)
	if err != nil {
		return "", fmt.Errorf("update encrypted Shared Vault key wrap: %w", err)
	}
	if command.RowsAffected() != 1 {
		return sharedapp.EncryptedPayloadMigrationConflict, nil
	}
	if err := transaction.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit Shared Vault key-wrap migration: %w", err)
	}
	return sharedapp.EncryptedPayloadMigrationCommitted, nil
}

func validKeyWrapMigration(migration sharedapp.EncryptedPayloadMigration) bool {
	replacement := migration.ReplacementCiphertext
	if migration.ExpectedEnvelopeVersion != 1 || migration.ReplacementEnvelopeVersion != 2 ||
		!sharedapp.HasSHA256Base64URLDigestShape(migration.ExpectedCiphertextDigest) ||
		!sharedapp.HasSHA256Base64URLDigestShape(migration.ReplacementCiphertextDigest) ||
		migration.OperationID != migration.ReplacementCiphertextDigest || len(replacement) < 29 || len(replacement) > 1_000_000 ||
		replacement[0] != '{' || !utf8.Valid(replacement) ||
		sharedapp.SHA256Base64URL(replacement) != migration.ReplacementCiphertextDigest {
		return false
	}
	var value map[string]any
	if err := json.Unmarshal(replacement, &value); err != nil || value == nil || len(value) != 4 {
		return false
	}
	for name := range value {
		if name != "ciphertext" && name != "ephemeralPublicKey" && name != "nonce" && name != "version" {
			return false
		}
	}
	version, ok := value["version"].(float64)
	if !ok || version != 2 {
		return false
	}
	ciphertext, ok := value["ciphertext"].(string)
	if !ok || !validBase64Characters(ciphertext, 64) {
		return false
	}
	nonce, ok := value["nonce"].(string)
	if !ok || !validBase64Characters(nonce, 16) {
		return false
	}
	publicKey, ok := value["ephemeralPublicKey"].(map[string]any)
	if !ok || !validPublicP256Key(publicKey) {
		return false
	}
	return true
}

func isLegacyKeyWrapCiphertext(value []byte) bool {
	if len(value) == 0 {
		return false
	}
	if value[0] != '{' {
		return value[0] == 1
	}
	if !utf8.Valid(value) {
		return false
	}
	var parsed map[string]any
	if err := json.Unmarshal(value, &parsed); err != nil || parsed == nil {
		return false
	}
	version, ok := parsed["version"].(float64)
	return ok && version == 1
}

func validPublicP256Key(key map[string]any) bool {
	for name := range key {
		if name != "crv" && name != "ext" && name != "key_ops" && name != "kty" && name != "x" && name != "y" {
			return false
		}
	}
	if ext, exists := key["ext"]; exists {
		if _, ok := ext.(bool); !ok {
			return false
		}
	}
	if operations, exists := key["key_ops"]; exists {
		values, ok := operations.([]any)
		if !ok || len(values) != 0 {
			return false
		}
	}
	kty, ktyOK := key["kty"].(string)
	curve, curveOK := key["crv"].(string)
	x, xOK := key["x"].(string)
	y, yOK := key["y"].(string)
	return ktyOK && kty == "EC" && curveOK && curve == "P-256" &&
		xOK && validBase64URLCoordinate(x) && yOK && validBase64URLCoordinate(y)
}

func validBase64Characters(value string, expectedLength int) bool {
	if len(value) != expectedLength {
		return false
	}
	for index := range value {
		character := value[index]
		if !(character >= 'A' && character <= 'Z') && !(character >= 'a' && character <= 'z') &&
			!(character >= '0' && character <= '9') && character != '+' && character != '/' {
			return false
		}
	}
	return true
}

func validBase64URLCoordinate(value string) bool {
	if len(value) != 43 {
		return false
	}
	for index := range value {
		character := value[index]
		if !(character >= 'A' && character <= 'Z') && !(character >= 'a' && character <= 'z') &&
			!(character >= '0' && character <= '9') && character != '_' && character != '-' {
			return false
		}
	}
	return true
}

func nullableBool(value pgtype.Bool) *bool {
	if !value.Valid {
		return nil
	}
	result := value.Bool
	return &result
}

func copyAccessBytes(value []byte) []byte {
	return append([]byte(nil), value...)
}

func clearSharedVaultAccesses(vaults []membershipapp.SharedVaultAccess) {
	for vaultIndex := range vaults {
		clear(vaults[vaultIndex].EncryptedName)
		clear(vaults[vaultIndex].EncryptedVaultKey)
		for accountIndex := range vaults[vaultIndex].Accounts {
			clear(vaults[vaultIndex].Accounts[accountIndex].EncryptedPayload)
		}
	}
}

var _ membershipapp.SharedVaultAccessRepository = (*PostgresSharedVaultAccessRepository)(nil)
