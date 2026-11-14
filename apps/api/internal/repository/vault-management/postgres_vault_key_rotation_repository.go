package infrastructure

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	vaultdomain "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity/vault-management"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/audit"
	identity "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity"
	vaultapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/vault-management"
)

type PostgresVaultKeyRotationRepository struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewPostgresVaultKeyRotationRepository(pool *pgxpool.Pool, now func() time.Time) (*PostgresVaultKeyRotationRepository, error) {
	if pool == nil {
		return nil, errors.New("Vault key rotation repository is not configured")
	}
	if now == nil {
		now = time.Now
	}
	return &PostgresVaultKeyRotationRepository{pool: pool, now: now}, nil
}

func (repository *PostgresVaultKeyRotationRepository) Snapshot(
	ctx context.Context,
	ownerID string,
	vaultID string,
) (*vaultapp.VaultKeyRotationSnapshot, error) {
	if ownerID == "" || vaultID == "" {
		return nil, nil
	}
	now := repository.now()
	legacyRecoveryCutoff := vaultdomain.LegacyVaultRecoveryCutoff(now)
	var encryptedName []byte
	var encryptionVersion int32
	err := repository.pool.QueryRow(ctx, `
		SELECT encrypted_name, encryption_version
		FROM vaults
		WHERE id = $1 AND owner_id = $2 AND type = 'SHARED' AND lifecycle = 'ACTIVE' AND deleted_at IS NULL`,
		vaultID, ownerID).Scan(&encryptedName, &encryptionVersion)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && encryptedName == nil) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read Shared Vault key rotation snapshot: %w", err)
	}
	members, err := repository.readSnapshotMembers(ctx, repository.pool, vaultID)
	if err != nil {
		return nil, err
	}
	memberIDs := make([]string, len(members))
	versions := make(map[string]struct{}, len(members))
	var currentKeyVersion *int64
	versionConsistent := len(members) > 0
	for index, member := range members {
		memberIDs[index] = member.userID
		versionKey := "null"
		if member.databaseKeyVersion.Valid {
			version := int64(member.databaseKeyVersion.Int32)
			versionKey = fmt.Sprintf("int:%d", version)
			if currentKeyVersion == nil {
				currentKeyVersion = &version
			}
		} else {
			versionConsistent = false
		}
		versions[versionKey] = struct{}{}
	}
	if len(versions) != 1 || !versionConsistent {
		currentKeyVersion = nil
	}
	publicKeys, err := identity.ReadUserEncryptionPublicKeys(ctx, repository.pool, memberIDs)
	if err != nil {
		return nil, err
	}
	accounts, err := repository.readSnapshotAccounts(ctx, repository.pool, vaultID, now, legacyRecoveryCutoff)
	if err != nil {
		return nil, err
	}
	var pendingInvitationCount int64
	if err := repository.pool.QueryRow(ctx, `
		SELECT count(*)
		FROM vault_invitations
		WHERE vault_id = $1 AND status = 'PENDING' AND expires_at > $2`, vaultID, now).Scan(&pendingInvitationCount); err != nil {
		return nil, fmt.Errorf("count pending Shared Vault rotation invitations: %w", err)
	}
	snapshotMembers := make([]vaultapp.VaultKeyRotationMemberSnapshot, len(members))
	for index, member := range members {
		var keyVersion *int64
		if member.encryptedVaultKey != nil && member.databaseKeyVersion.Valid {
			version := int64(member.databaseKeyVersion.Int32)
			keyVersion = &version
		}
		snapshotMembers[index] = vaultapp.VaultKeyRotationMemberSnapshot{
			UserID: member.userID, KeyVersion: keyVersion, PublicKey: publicKeys[member.userID],
		}
	}
	return &vaultapp.VaultKeyRotationSnapshot{
		VaultID: vaultID, EncryptedName: append([]byte(nil), encryptedName...), EncryptionVersion: int(encryptionVersion),
		CurrentKeyVersion: currentKeyVersion, PendingInvitationCount: int(pendingInvitationCount),
		Accounts: accounts, Members: snapshotMembers,
	}, nil
}

func (repository *PostgresVaultKeyRotationRepository) Rotate(
	ctx context.Context,
	ownerID string,
	vaultID string,
	rotation vaultapp.VaultKeyRotation,
) (bool, error) {
	if ownerID == "" || vaultID == "" || rotation.ExpectedKeyVersion < 1 || rotation.KeyVersion != rotation.ExpectedKeyVersion+1 ||
		rotation.EncryptionVersion != 1 || len(rotation.Accounts) > vaultapp.MaxVaultKeyRotationAccounts ||
		len(rotation.MemberPackages) > vaultapp.MaxVaultKeyRotationMemberPackages ||
		!uniqueStringIDs(rotation.Accounts, func(value vaultapp.VaultKeyRotationAccountReplacement) string { return value.ID }) ||
		!uniqueStringIDs(rotation.MemberPackages, func(value vaultapp.VaultKeyRotationMemberPackage) string { return value.UserID }) {
		return false, nil
	}
	transaction, err := repository.pool.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("begin Shared Vault key rotation: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	var currentEncryptedName []byte
	err = transaction.QueryRow(ctx, `
		SELECT encrypted_name
		FROM vaults
		WHERE id = $1 AND owner_id = $2 AND type = 'SHARED' AND lifecycle = 'ACTIVE' AND deleted_at IS NULL
		FOR UPDATE`, vaultID, ownerID).Scan(&currentEncryptedName)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !bytes.Equal(currentEncryptedName, rotation.ExpectedEncryptedName)) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("lock Shared Vault for key rotation: %w", err)
	}
	lockedMemberIDs, err := lockRotationMemberIDs(ctx, transaction, vaultID)
	if err != nil {
		return false, fmt.Errorf("lock active Shared Vault members for rotation: %w", err)
	}
	if len(lockedMemberIDs) > vaultapp.MaxVaultKeyRotationMemberPackages {
		return false, nil
	}
	now := repository.now()
	legacyRecoveryCutoff := vaultdomain.LegacyVaultRecoveryCutoff(now)
	lockedAccountIDs, err := lockRotationAccountIDs(ctx, transaction, vaultID, now, legacyRecoveryCutoff)
	if err != nil {
		return false, fmt.Errorf("lock recoverable Shared Vault accounts for rotation: %w", err)
	}
	if len(lockedAccountIDs) > vaultapp.MaxVaultKeyRotationAccounts {
		return false, nil
	}
	members, err := repository.readSnapshotMembers(ctx, transaction, vaultID)
	if err != nil {
		return false, err
	}
	memberIDs := make([]string, len(members))
	for index, member := range members {
		memberIDs[index] = member.userID
		if !member.databaseKeyVersion.Valid || int64(member.databaseKeyVersion.Int32) != rotation.ExpectedKeyVersion {
			return false, nil
		}
	}
	publicKeys, err := identity.ReadUserEncryptionPublicKeys(ctx, transaction, memberIDs)
	if err != nil {
		return false, err
	}
	accountRows, err := repository.readCurrentAccountRevisions(ctx, transaction, vaultID, now, legacyRecoveryCutoff)
	if err != nil {
		return false, err
	}
	if !sameStringIDs(lockedMemberIDs, memberPackageIDs(rotation.MemberPackages)) ||
		!sameStringIDs(memberIDs, memberPackageIDs(rotation.MemberPackages)) ||
		!sameStringIDs(lockedAccountIDs, accountReplacementIDs(rotation.Accounts)) ||
		len(accountRows) != len(rotation.Accounts) ||
		!rotationPublicKeysMatch(members, publicKeys, rotation.MemberPackages) ||
		!rotationAccountRevisionsMatch(accountRows, rotation.Accounts) {
		return false, nil
	}
	if _, err := transaction.Exec(ctx, `
		UPDATE vaults SET encrypted_name = $2, encryption_version = $3, updated_at = $4
		WHERE id = $1`, vaultID, rotation.EncryptedName, rotation.EncryptionVersion, now); err != nil {
		return false, fmt.Errorf("replace Shared Vault encrypted name during rotation: %w", err)
	}
	for _, member := range rotation.MemberPackages {
		if _, err := transaction.Exec(ctx, `
			UPDATE vault_members SET encrypted_vault_key = $3, key_version = $4, updated_at = $5
			WHERE vault_id = $1 AND user_id = $2`, vaultID, member.UserID, member.EncryptedVaultKey, rotation.KeyVersion, now); err != nil {
			return false, fmt.Errorf("replace Shared Vault member key package: %w", err)
		}
	}
	for _, account := range rotation.Accounts {
		if _, err := transaction.Exec(ctx, `
			UPDATE authenticator_accounts
			SET encrypted_payload = $2, revision = revision + 1, updated_at = $3
			WHERE id = $1`, account.ID, account.EncryptedPayload, now); err != nil {
			return false, fmt.Errorf("replace recoverable Shared Vault account during rotation: %w", err)
		}
	}
	if _, err := transaction.Exec(ctx, `DELETE FROM vault_invitations WHERE vault_id = $1 AND status = 'PENDING'`, vaultID); err != nil {
		return false, fmt.Errorf("invalidate pending invitations during Shared Vault rotation: %w", err)
	}
	if err := audit.AppendVaultAuditEvent(ctx, transaction, audit.VaultAuditAppend{
		VaultID: vaultID, OwnerID: ownerID, ActorUserID: ownerID, Action: audit.ActionVaultKeyRotated,
	}); err != nil {
		return false, err
	}
	if err := transaction.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit Shared Vault key rotation: %w", err)
	}
	return true, nil
}

type rotationMemberRecord struct {
	userID             string
	encryptedVaultKey  []byte
	databaseKeyVersion pgtype.Int4
}

func (repository *PostgresVaultKeyRotationRepository) readSnapshotMembers(
	ctx context.Context,
	queryer interface {
		Query(context.Context, string, ...any) (pgx.Rows, error)
	},
	vaultID string,
) ([]rotationMemberRecord, error) {
	rows, err := queryer.Query(ctx, `
		SELECT user_id, encrypted_vault_key, key_version
		FROM vault_members
		WHERE vault_id = $1 AND status = 'ACTIVE'
		ORDER BY user_id ASC
		LIMIT $2`, vaultID, vaultapp.MaxVaultKeyRotationMemberPackages+1)
	if err != nil {
		return nil, fmt.Errorf("list active Shared Vault key rotation members: %w", err)
	}
	defer rows.Close()
	members := make([]rotationMemberRecord, 0, vaultapp.MaxVaultKeyRotationMemberPackages+1)
	for rows.Next() {
		var member rotationMemberRecord
		if err := rows.Scan(&member.userID, &member.encryptedVaultKey, &member.databaseKeyVersion); err != nil {
			return nil, fmt.Errorf("scan active Shared Vault key rotation member: %w", err)
		}
		members = append(members, member)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate active Shared Vault key rotation members: %w", err)
	}
	return members, nil
}

func (repository *PostgresVaultKeyRotationRepository) readSnapshotAccounts(
	ctx context.Context,
	queryer interface {
		Query(context.Context, string, ...any) (pgx.Rows, error)
	},
	vaultID string,
	now time.Time,
	legacyRecoveryCutoff time.Time,
) ([]vaultapp.VaultKeyRotationAccountSnapshot, error) {
	rows, err := queryer.Query(ctx, `
		SELECT id, encrypted_payload, encryption_version, revision, deleted_at
		FROM authenticator_accounts
		WHERE vault_id = $1
		  AND (deleted_at IS NULL OR purge_after > $2 OR (purge_after IS NULL AND deleted_at > $3))
		ORDER BY id ASC
		LIMIT $4`, vaultID, now, legacyRecoveryCutoff, vaultapp.MaxVaultKeyRotationAccounts+1)
	if err != nil {
		return nil, fmt.Errorf("list recoverable Shared Vault accounts for rotation: %w", err)
	}
	defer rows.Close()
	accounts := make([]vaultapp.VaultKeyRotationAccountSnapshot, 0, vaultapp.MaxVaultKeyRotationAccounts+1)
	for rows.Next() {
		var id string
		var encryptedPayload []byte
		var encryptionVersion, revision int32
		var deletedAt pgtype.Timestamp
		if err := rows.Scan(&id, &encryptedPayload, &encryptionVersion, &revision, &deletedAt); err != nil {
			return nil, fmt.Errorf("scan recoverable Shared Vault account for rotation: %w", err)
		}
		var deletedAtValue *time.Time
		if deletedAt.Valid {
			value := deletedAt.Time
			deletedAtValue = &value
		}
		accounts = append(accounts, vaultapp.VaultKeyRotationAccountSnapshot{
			ID: id, EncryptedPayload: append([]byte(nil), encryptedPayload...), EncryptionVersion: int(encryptionVersion),
			Revision: int64(revision), DeletedAt: deletedAtValue,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate recoverable Shared Vault accounts for rotation: %w", err)
	}
	return accounts, nil
}

func lockRotationMemberIDs(ctx context.Context, transaction pgx.Tx, vaultID string) ([]string, error) {
	rows, err := transaction.Query(ctx, `
		SELECT user_id FROM vault_members
		WHERE vault_id = $1 AND status = 'ACTIVE'
		ORDER BY user_id ASC
		LIMIT $2
		FOR UPDATE`, vaultID, vaultapp.MaxVaultKeyRotationMemberPackages+1)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func lockRotationAccountIDs(ctx context.Context, transaction pgx.Tx, vaultID string, now, legacyRecoveryCutoff time.Time) ([]string, error) {
	rows, err := transaction.Query(ctx, `
		SELECT id FROM authenticator_accounts
		WHERE vault_id = $1
		  AND (deleted_at IS NULL OR purge_after > $2 OR (purge_after IS NULL AND deleted_at > $3))
		ORDER BY id ASC
		LIMIT $4
		FOR UPDATE`, vaultID, now, legacyRecoveryCutoff, vaultapp.MaxVaultKeyRotationAccounts+1)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (repository *PostgresVaultKeyRotationRepository) readCurrentAccountRevisions(
	ctx context.Context,
	transaction pgx.Tx,
	vaultID string,
	now time.Time,
	legacyRecoveryCutoff time.Time,
) (map[string]int64, error) {
	rows, err := transaction.Query(ctx, `
		SELECT id, revision FROM authenticator_accounts
		WHERE vault_id = $1
		  AND (deleted_at IS NULL OR purge_after > $2 OR (purge_after IS NULL AND deleted_at > $3))
		ORDER BY id ASC`, vaultID, now, legacyRecoveryCutoff)
	if err != nil {
		return nil, fmt.Errorf("read current Shared Vault rotation account revisions: %w", err)
	}
	defer rows.Close()
	revisions := make(map[string]int64)
	for rows.Next() {
		var id string
		var revision int32
		if err := rows.Scan(&id, &revision); err != nil {
			return nil, fmt.Errorf("scan current Shared Vault rotation account revision: %w", err)
		}
		revisions[id] = int64(revision)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate current Shared Vault rotation account revisions: %w", err)
	}
	return revisions, nil
}

func rotationPublicKeysMatch(
	members []rotationMemberRecord,
	currentPublicKeys map[string]*identity.PublicEncryptionKey,
	submitted []vaultapp.VaultKeyRotationMemberPackage,
) bool {
	if len(members) != len(submitted) {
		return false
	}
	for _, member := range members {
		current := currentPublicKeys[member.userID]
		var submittedKey *identity.PublicEncryptionKey
		for index := range submitted {
			if submitted[index].UserID == member.userID {
				key := submitted[index].ExpectedPublicKey
				submittedKey = &key
				break
			}
		}
		if current == nil || submittedKey == nil || !identity.PublicEncryptionKeysEqual(*current, *submittedKey) {
			return false
		}
	}
	return true
}

func rotationAccountRevisionsMatch(current map[string]int64, submitted []vaultapp.VaultKeyRotationAccountReplacement) bool {
	if len(current) != len(submitted) {
		return false
	}
	for _, account := range submitted {
		revision, exists := current[account.ID]
		if !exists || revision != account.Revision {
			return false
		}
	}
	return true
}

func memberPackageIDs(values []vaultapp.VaultKeyRotationMemberPackage) []string {
	ids := make([]string, len(values))
	for index, value := range values {
		ids[index] = value.UserID
	}
	return ids
}

func accountReplacementIDs(values []vaultapp.VaultKeyRotationAccountReplacement) []string {
	ids := make([]string, len(values))
	for index, value := range values {
		ids[index] = value.ID
	}
	return ids
}

func sameStringIDs(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	leftSet := make(map[string]struct{}, len(left))
	for _, value := range left {
		if _, exists := leftSet[value]; exists {
			return false
		}
		leftSet[value] = struct{}{}
	}
	for _, value := range right {
		if _, exists := leftSet[value]; !exists {
			return false
		}
		delete(leftSet, value)
	}
	return len(leftSet) == 0
}

func uniqueStringIDs[T any](values []T, id func(T) string) bool {
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		key := id(value)
		if key == "" {
			return false
		}
		if _, exists := seen[key]; exists {
			return false
		}
		seen[key] = struct{}{}
	}
	return true
}

var _ vaultapp.VaultKeyRotationRepository = (*PostgresVaultKeyRotationRepository)(nil)
