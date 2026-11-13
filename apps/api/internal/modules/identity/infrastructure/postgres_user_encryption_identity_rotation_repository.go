package infrastructure

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity/application"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/postgres"
)

const maxUserEncryptionIdentityRotationMemberships = 500

type PostgresUserEncryptionIdentityRotationRepository struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewPostgresUserEncryptionIdentityRotationRepository(pool *pgxpool.Pool, now func() time.Time) (*PostgresUserEncryptionIdentityRotationRepository, error) {
	if pool == nil {
		return nil, errors.New("user encryption identity rotation repository is not configured")
	}
	if now == nil {
		now = time.Now
	}
	return &PostgresUserEncryptionIdentityRotationRepository{pool: pool, now: now}, nil
}

func (repository *PostgresUserEncryptionIdentityRotationRepository) Snapshot(ctx context.Context, userID string) (*identityapp.UserEncryptionIdentityRotationSnapshot, error) {
	if userID == "" {
		return nil, nil
	}
	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, fmt.Errorf("begin user encryption identity snapshot: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()

	var publicKey []byte
	var encryptedPrivateKey []byte
	var encryptionVersion pgtype.Int4
	err = transaction.QueryRow(ctx, `
		SELECT user_encryption_public_key, encrypted_user_private_key, user_encryption_key_version
		FROM user_crypto_profiles
		WHERE user_id = $1`, userID).Scan(&publicKey, &encryptedPrivateKey, &encryptionVersion)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && (len(publicKey) == 0 || strings.TrimSpace(string(publicKey)) == "null" || encryptedPrivateKey == nil || !encryptionVersion.Valid) {
		if commitErr := transaction.Commit(ctx); commitErr != nil {
			return nil, fmt.Errorf("commit empty user encryption identity snapshot: %w", commitErr)
		}
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load user encryption identity snapshot: %w", err)
	}
	snapshot := &identityapp.UserEncryptionIdentityRotationSnapshot{
		PublicKey:           append(json.RawMessage(nil), publicKey...),
		EncryptedPrivateKey: append([]byte(nil), encryptedPrivateKey...),
		EncryptionVersion:   int(encryptionVersion.Int32),
		Memberships:         make([]identityapp.UserEncryptionIdentityRotationMembership, 0),
	}
	rows, err := transaction.Query(ctx, `
		SELECT member.vault_id, vault.owner_id, member.encrypted_vault_key, member.key_version
		FROM vault_members AS member
		JOIN vaults AS vault ON vault.id = member.vault_id
		WHERE member.user_id = $1
		  AND member.status = 'ACTIVE'
		  AND vault.type = 'SHARED'
		  AND vault.lifecycle = 'ACTIVE'
		  AND vault.deleted_at IS NULL
		ORDER BY member.vault_id
		LIMIT $2`, userID, maxUserEncryptionIdentityRotationMemberships+1)
	if err != nil {
		return nil, fmt.Errorf("load active user encryption identity memberships: %w", err)
	}
	for rows.Next() {
		var membership identityapp.UserEncryptionIdentityRotationMembership
		var keyVersion pgtype.Int4
		if err := rows.Scan(&membership.VaultID, &membership.OwnerID, &membership.EncryptedVaultKey, &keyVersion); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan active user encryption identity membership: %w", err)
		}
		if keyVersion.Valid {
			membership.KeyVersion = int(keyVersion.Int32)
		}
		snapshot.Memberships = append(snapshot.Memberships, membership)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, fmt.Errorf("read active user encryption identity memberships: %w", err)
	}
	rows.Close()
	if err := transaction.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit user encryption identity snapshot: %w", err)
	}
	return snapshot, nil
}

func (repository *PostgresUserEncryptionIdentityRotationRepository) Rotate(ctx context.Context, userID string, rotation identityapp.UserEncryptionIdentityRotation) (bool, error) {
	if !validUserEncryptionIdentityRotation(userID, rotation) {
		return false, nil
	}
	expectedPublicKey, err := json.Marshal(rotation.ExpectedPublicKey)
	if err != nil {
		return false, errors.New("user encryption identity rotation is invalid")
	}
	newPublicKey, err := json.Marshal(rotation.PublicKey)
	if err != nil {
		return false, errors.New("user encryption identity rotation is invalid")
	}
	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return false, fmt.Errorf("begin user encryption identity rotation: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	if _, err := transaction.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, userID); err != nil {
		return false, fmt.Errorf("lock user encryption identity rotation: %w", err)
	}

	var currentPublicKey []byte
	var currentPrivateKey []byte
	var currentVersion pgtype.Int4
	err = transaction.QueryRow(ctx, `
		SELECT user_encryption_public_key, encrypted_user_private_key, user_encryption_key_version
		FROM user_crypto_profiles
		WHERE user_id = $1
		FOR UPDATE`, userID).Scan(&currentPublicKey, &currentPrivateKey, &currentVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("load current user encryption identity: %w", err)
	}
	defer clear(currentPublicKey)
	defer clear(currentPrivateKey)
	parsedCurrentKey, err := identityapp.ParseUserEncryptionPublicKey(currentPublicKey)
	if err != nil || !currentVersion.Valid || int(currentVersion.Int32) != rotation.ExpectedEncryptionVersion ||
		!reflect.DeepEqual(parsedCurrentKey, rotation.ExpectedPublicKey) ||
		!constantTimeBytesEqual(currentPrivateKey, rotation.ExpectedEncryptedPrivateKey) {
		return false, nil
	}

	initialMembershipIDs, err := listActiveIdentityRotationMembershipIDs(ctx, transaction, userID)
	if err != nil {
		return false, err
	}
	submittedMembershipIDs := userEncryptionIdentityRotationMembershipIDs(rotation.Memberships)
	if !sameIdentityRotationIDs(initialMembershipIDs, submittedMembershipIDs) {
		return false, nil
	}
	for _, vaultID := range initialMembershipIDs {
		var lockedVaultID string
		err := transaction.QueryRow(ctx, `
			SELECT id FROM vaults
			WHERE id = $1 AND type = 'SHARED' AND lifecycle = 'ACTIVE' AND deleted_at IS NULL
			FOR UPDATE`, vaultID).Scan(&lockedVaultID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return false, fmt.Errorf("lock active user encryption identity vault: %w", err)
		}
	}
	if err := lockActiveIdentityRotationMemberships(ctx, transaction, userID); err != nil {
		return false, err
	}
	memberships, err := listActiveIdentityRotationMemberships(ctx, transaction, userID)
	if err != nil {
		return false, err
	}
	if !sameIdentityRotationIDs(userEncryptionIdentityRotationMembershipIDs(memberships), submittedMembershipIDs) {
		return false, nil
	}
	submittedByVault := make(map[string]identityapp.UserEncryptionIdentityRotationMembership, len(rotation.Memberships))
	for _, submitted := range rotation.Memberships {
		submittedByVault[submitted.VaultID] = submitted
	}
	for _, current := range memberships {
		submitted := submittedByVault[current.VaultID]
		if current.KeyVersion != submitted.ExpectedKeyVersion || len(current.EncryptedVaultKey) == 0 ||
			!constantTimeBytesEqual(current.EncryptedVaultKey, submitted.ExpectedVaultKey) {
			return false, nil
		}
	}

	now := repository.now()
	command, err := transaction.Exec(ctx, `
		UPDATE user_crypto_profiles
		SET user_encryption_public_key = $2::jsonb,
		    encrypted_user_private_key = $3,
		    user_encryption_key_version = $4,
		    updated_at = $5
		WHERE user_id = $1
		  AND user_encryption_public_key = $6::jsonb
		  AND encrypted_user_private_key = $7
		  AND user_encryption_key_version = $8`,
		userID, string(newPublicKey), rotation.EncryptedPrivateKey, rotation.EncryptionVersion,
		now, string(expectedPublicKey), rotation.ExpectedEncryptedPrivateKey, rotation.ExpectedEncryptionVersion)
	if err != nil {
		return false, fmt.Errorf("update user encryption identity: %w", err)
	}
	if command.RowsAffected() != 1 {
		return false, nil
	}
	for _, current := range memberships {
		submitted := submittedByVault[current.VaultID]
		command, err := transaction.Exec(ctx, `
			UPDATE vault_members
			SET encrypted_vault_key = $5, updated_at = $6
			WHERE vault_id = $1 AND user_id = $2 AND status = 'ACTIVE'
			  AND key_version = $3 AND encrypted_vault_key = $4`,
			current.VaultID, userID, submitted.ExpectedKeyVersion, submitted.ExpectedVaultKey, submitted.ReplacementVaultKey, now)
		if err != nil {
			return false, fmt.Errorf("update encrypted Shared Vault membership key wrap: %w", err)
		}
		if command.RowsAffected() != 1 {
			return false, nil
		}
	}
	for _, membership := range memberships {
		eventID, err := postgres.NewCUID()
		if err != nil {
			return false, fmt.Errorf("create user encryption identity rotation audit event: %w", err)
		}
		if _, err := transaction.Exec(ctx, `
			INSERT INTO vault_audit_events (id, vault_id, owner_id, actor_user_id, event_type, created_at)
			VALUES ($1, $2, $3, $4, 'USER_ENCRYPTION_KEY_PAIR_ROTATED', $5)`,
			eventID, membership.VaultID, membership.OwnerID, userID, now); err != nil {
			return false, fmt.Errorf("append user encryption identity rotation audit event: %w", err)
		}
	}
	if err := transaction.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit user encryption identity rotation: %w", err)
	}
	return true, nil
}

func validUserEncryptionIdentityRotation(userID string, rotation identityapp.UserEncryptionIdentityRotation) bool {
	if userID == "" || rotation.ExpectedEncryptionVersion != 1 || rotation.EncryptionVersion != 1 ||
		!validEncryptedProfileBlob(rotation.ExpectedEncryptedPrivateKey) || !validEncryptedProfileBlob(rotation.EncryptedPrivateKey) ||
		identityapp.ValidateUserEncryptionPublicKey(rotation.ExpectedPublicKey) != nil ||
		identityapp.ValidateUserEncryptionPublicKey(rotation.PublicKey) != nil ||
		len(rotation.Memberships) > maxUserEncryptionIdentityRotationMemberships {
		return false
	}
	seenVaultIDs := make(map[string]struct{}, len(rotation.Memberships))
	for _, membership := range rotation.Memberships {
		if membership.VaultID == "" || membership.ExpectedKeyVersion < 1 ||
			!validEncryptedProfileBlob(membership.ExpectedVaultKey) || !validEncryptedProfileBlob(membership.ReplacementVaultKey) {
			return false
		}
		if _, exists := seenVaultIDs[membership.VaultID]; exists {
			return false
		}
		seenVaultIDs[membership.VaultID] = struct{}{}
	}
	return true
}

func listActiveIdentityRotationMembershipIDs(ctx context.Context, transaction pgx.Tx, userID string) ([]string, error) {
	rows, err := transaction.Query(ctx, `
		SELECT member.vault_id
		FROM vault_members AS member
		JOIN vaults AS vault ON vault.id = member.vault_id
		WHERE member.user_id = $1 AND member.status = 'ACTIVE'
		  AND vault.type = 'SHARED' AND vault.lifecycle = 'ACTIVE' AND vault.deleted_at IS NULL
		ORDER BY member.vault_id
		LIMIT $2`, userID, maxUserEncryptionIdentityRotationMemberships+1)
	if err != nil {
		return nil, fmt.Errorf("list active Shared Vault memberships: %w", err)
	}
	defer rows.Close()
	var membershipIDs []string
	for rows.Next() {
		var vaultID string
		if err := rows.Scan(&vaultID); err != nil {
			return nil, fmt.Errorf("scan active Shared Vault membership ID: %w", err)
		}
		membershipIDs = append(membershipIDs, vaultID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read active Shared Vault membership IDs: %w", err)
	}
	return membershipIDs, nil
}

func lockActiveIdentityRotationMemberships(ctx context.Context, transaction pgx.Tx, userID string) error {
	rows, err := transaction.Query(ctx, `
		SELECT vault_id
		FROM vault_members
		WHERE user_id = $1 AND status = 'ACTIVE'
		ORDER BY vault_id
		FOR UPDATE`, userID)
	if err != nil {
		return fmt.Errorf("lock active user membership rows: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var vaultID string
		if err := rows.Scan(&vaultID); err != nil {
			return fmt.Errorf("scan active membership lock: %w", err)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read active membership locks: %w", err)
	}
	return nil
}

func listActiveIdentityRotationMemberships(ctx context.Context, transaction pgx.Tx, userID string) ([]identityapp.UserEncryptionIdentityRotationMembership, error) {
	rows, err := transaction.Query(ctx, `
		SELECT member.vault_id, vault.owner_id, member.encrypted_vault_key, member.key_version
		FROM vault_members AS member
		JOIN vaults AS vault ON vault.id = member.vault_id
		WHERE member.user_id = $1 AND member.status = 'ACTIVE'
		  AND vault.type = 'SHARED' AND vault.lifecycle = 'ACTIVE' AND vault.deleted_at IS NULL
		ORDER BY member.vault_id
		LIMIT $2`, userID, maxUserEncryptionIdentityRotationMemberships+1)
	if err != nil {
		return nil, fmt.Errorf("reload active Shared Vault memberships: %w", err)
	}
	defer rows.Close()
	memberships := make([]identityapp.UserEncryptionIdentityRotationMembership, 0)
	for rows.Next() {
		var membership identityapp.UserEncryptionIdentityRotationMembership
		var keyVersion pgtype.Int4
		if err := rows.Scan(&membership.VaultID, &membership.OwnerID, &membership.EncryptedVaultKey, &keyVersion); err != nil {
			return nil, fmt.Errorf("scan active Shared Vault membership snapshot: %w", err)
		}
		if keyVersion.Valid {
			membership.KeyVersion = int(keyVersion.Int32)
		}
		memberships = append(memberships, membership)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read active Shared Vault membership snapshot: %w", err)
	}
	return memberships, nil
}

func userEncryptionIdentityRotationMembershipIDs(memberships []identityapp.UserEncryptionIdentityRotationMembership) []string {
	ids := make([]string, len(memberships))
	for index, membership := range memberships {
		ids[index] = membership.VaultID
	}
	return ids
}

func sameIdentityRotationIDs(current []string, submitted []string) bool {
	if len(current) != len(submitted) {
		return false
	}
	currentIDs := make(map[string]struct{}, len(current))
	for _, vaultID := range current {
		currentIDs[vaultID] = struct{}{}
	}
	submittedIDs := make(map[string]struct{}, len(submitted))
	for _, vaultID := range submitted {
		submittedIDs[vaultID] = struct{}{}
	}
	if len(currentIDs) != len(current) || len(submittedIDs) != len(submitted) {
		return false
	}
	for vaultID := range currentIDs {
		if _, exists := submittedIDs[vaultID]; !exists {
			return false
		}
	}
	return true
}

var _ identityapp.UserEncryptionIdentityRotationRepository = (*PostgresUserEncryptionIdentityRotationRepository)(nil)
