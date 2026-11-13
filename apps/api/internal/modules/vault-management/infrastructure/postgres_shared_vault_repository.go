package infrastructure

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	identity "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity"
	vaultmanagement "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-management"
	vaultapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-management/application"
	vaultdomain "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-management/domain"
	vaultmembership "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-membership"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/postgres"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

const maxSharedVaultEncryptedBlobBytes = 16*1024 + 29

type PostgresSharedVaultRepository struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewPostgresSharedVaultRepository(pool *pgxpool.Pool, now func() time.Time) (*PostgresSharedVaultRepository, error) {
	if pool == nil {
		return nil, errors.New("Shared Vault repository is not configured")
	}
	if now == nil {
		now = time.Now
	}
	return &PostgresSharedVaultRepository{pool: pool, now: now}, nil
}

func (repository *PostgresSharedVaultRepository) Create(
	ctx context.Context,
	ownerID string,
	vault vaultapp.NewSharedVault,
) (vaultdomain.Vault, error) {
	if !validNewSharedVault(ownerID, vault) {
		return vaultdomain.Vault{}, errors.New("Shared Vault creation is invalid")
	}
	vaultID := vault.ID
	if vaultID == "" {
		generatedID, err := postgres.NewCUID()
		if err != nil {
			return vaultdomain.Vault{}, err
		}
		vaultID = generatedID
	}
	encryptedName := copySharedVaultBytes(vault.EncryptedName)
	defer clear(encryptedName)
	encryptedOwnerKey := copySharedVaultBytes(vault.EncryptedOwnerVaultKey)
	defer clear(encryptedOwnerKey)

	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return vaultdomain.Vault{}, fmt.Errorf("begin Shared Vault creation: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	if _, err := transaction.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, ownerID); err != nil {
		return vaultdomain.Vault{}, fmt.Errorf("lock Shared Vault owner identity: %w", err)
	}
	matches, err := identity.MatchesUserEncryptionPublicKey(ctx, transaction, ownerID, vault.ExpectedOwnerPublicKey)
	if err != nil {
		return vaultdomain.Vault{}, fmt.Errorf("verify Shared Vault owner identity: %w", err)
	}
	if !matches {
		return vaultdomain.Vault{}, vaultapp.ErrSharedVaultIdentityConflict
	}

	now := repository.now()
	if _, err := transaction.Exec(ctx, `
		INSERT INTO vaults (
			id, type, lifecycle, owner_id, encrypted_name, encryption_version, created_at, updated_at
		)
		VALUES ($1, 'SHARED', 'ACTIVE', $2, $3, $4, $5, $5)`,
		vaultID, ownerID, encryptedName, vault.EncryptionVersion, now); err != nil {
		return vaultdomain.Vault{}, fmt.Errorf("create Shared Vault: %w", err)
	}
	if _, err := transaction.Exec(ctx, `
		INSERT INTO vault_members (
			vault_id, user_id, role, status, encrypted_vault_key, key_version, created_at, updated_at
		)
		VALUES ($1, $2, 'OWNER', 'ACTIVE', $3, $4, $5, $5)`,
		vaultID, ownerID, encryptedOwnerKey, vault.EncryptionVersion, now); err != nil {
		return vaultdomain.Vault{}, fmt.Errorf("create Shared Vault owner membership: %w", err)
	}
	created, err := vaultdomain.NewVault(vaultID, vaultdomain.VaultTypeShared, ownerID, vaultdomain.VaultLifecycleActive)
	if err != nil {
		return vaultdomain.Vault{}, err
	}
	if err := transaction.Commit(ctx); err != nil {
		return vaultdomain.Vault{}, fmt.Errorf("commit Shared Vault creation: %w", err)
	}
	return created, nil
}

func (repository *PostgresSharedVaultRepository) Rename(
	ctx context.Context,
	ownerID string,
	vaultID string,
	encryptedName []byte,
	encryptionVersion int,
	expectedKeyVersion int64,
) (bool, error) {
	if ownerID == "" || vaultID == "" || !validSharedVaultEncryptedBlob(encryptedName) || encryptionVersion != 1 || expectedKeyVersion < 1 {
		return false, errors.New("Shared Vault rename is invalid")
	}
	replacement := copySharedVaultBytes(encryptedName)
	defer clear(replacement)

	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return false, fmt.Errorf("begin Shared Vault rename: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	var lockedVaultID string
	err = transaction.QueryRow(ctx, `
		SELECT id
		FROM vaults
		WHERE id = $1 AND owner_id = $2 AND type = 'SHARED' AND lifecycle = 'ACTIVE' AND deleted_at IS NULL
		FOR UPDATE`, vaultID, ownerID).Scan(&lockedVaultID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("lock owner Shared Vault for rename: %w", err)
	}

	var role, status string
	var keyVersion pgtype.Int4
	err = transaction.QueryRow(ctx, `
		SELECT role, status, key_version
		FROM vault_members
		WHERE vault_id = $1 AND user_id = $2
		FOR UPDATE`, vaultID, ownerID).Scan(&role, &status, &keyVersion)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (role != "OWNER" || status != "ACTIVE" || !keyVersion.Valid || int64(keyVersion.Int32) != expectedKeyVersion)) {
		return false, vaultapp.ErrSharedVaultKeyVersionConflict
	}
	if err != nil {
		return false, fmt.Errorf("lock owner Shared Vault membership for rename: %w", err)
	}

	command, err := transaction.Exec(ctx, `
		UPDATE vaults
		SET encrypted_name = $2, encryption_version = $3, updated_at = $4
		WHERE id = $1 AND owner_id = $5 AND type = 'SHARED' AND lifecycle = 'ACTIVE' AND deleted_at IS NULL`,
		vaultID, replacement, encryptionVersion, repository.now(), ownerID)
	if err != nil {
		return false, fmt.Errorf("update encrypted Shared Vault name: %w", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit Shared Vault rename: %w", err)
	}
	return command.RowsAffected() == 1, nil
}

func (repository *PostgresSharedVaultRepository) MigrateName(
	ctx context.Context,
	actorUserID string,
	vaultID string,
	expectedKeyVersion int64,
	migration sharedapp.EncryptedPayloadMigration,
) (sharedapp.EncryptedPayloadMigrationResult, error) {
	if actorUserID == "" || vaultID == "" || expectedKeyVersion < 1 {
		return sharedapp.EncryptedPayloadMigrationConflict, nil
	}
	replacement := copySharedVaultBytes(migration.ReplacementCiphertext)
	defer clear(replacement)
	migration.ReplacementCiphertext = replacement
	if !sharedapp.ValidateEncryptedPayloadMigration(migration) {
		return sharedapp.EncryptedPayloadMigrationConflict, nil
	}
	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return "", fmt.Errorf("begin Shared Vault name migration: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	_, available, err := vaultmanagement.LockActiveSharedVault(ctx, transaction, vaultID)
	if err != nil {
		return "", err
	}
	if !available {
		return sharedapp.EncryptedPayloadMigrationConflict, nil
	}
	membership, active, err := vaultmembership.LockActiveVaultMembership(ctx, transaction, vaultID, actorUserID)
	if err != nil {
		return "", err
	}
	if !active || membership.KeyVersion == nil || *membership.KeyVersion != expectedKeyVersion {
		return sharedapp.EncryptedPayloadMigrationConflict, nil
	}
	var current []byte
	var encryptionVersion int32
	if err := transaction.QueryRow(ctx, `
		SELECT encrypted_name, encryption_version
		FROM vaults
		WHERE id = $1`, vaultID).Scan(&current, &encryptionVersion); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return sharedapp.EncryptedPayloadMigrationConflict, nil
		}
		return "", fmt.Errorf("load Shared Vault name migration source: %w", err)
	}
	defer clear(current)
	if current == nil || encryptionVersion != 1 {
		return sharedapp.EncryptedPayloadMigrationConflict, nil
	}
	currentDigest := sharedapp.SHA256Base64URL(current)
	if currentDigest == migration.ReplacementCiphertextDigest {
		if err := transaction.Commit(ctx); err != nil {
			return "", fmt.Errorf("commit Shared Vault name migration replay: %w", err)
		}
		return sharedapp.EncryptedPayloadMigrationAlreadyCommitted, nil
	}
	if len(current) == 0 || current[0] != byte(migration.ExpectedEnvelopeVersion) || currentDigest != migration.ExpectedCiphertextDigest {
		return sharedapp.EncryptedPayloadMigrationConflict, nil
	}
	command, err := transaction.Exec(ctx, `
		UPDATE vaults
		SET encrypted_name = $2, updated_at = $3
		WHERE id = $1 AND type = 'SHARED' AND lifecycle = 'ACTIVE' AND deleted_at IS NULL
		  AND encryption_version = $4 AND encrypted_name = $5`,
		vaultID, replacement, repository.now(), encryptionVersion, current)
	if err != nil {
		return "", fmt.Errorf("update encrypted Shared Vault name: %w", err)
	}
	if command.RowsAffected() != 1 {
		return sharedapp.EncryptedPayloadMigrationConflict, nil
	}
	if err := transaction.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit Shared Vault name migration: %w", err)
	}
	return sharedapp.EncryptedPayloadMigrationCommitted, nil
}

func validNewSharedVault(ownerID string, vault vaultapp.NewSharedVault) bool {
	return ownerID != "" && vault.EncryptionVersion == 1 &&
		validSharedVaultEncryptedBlob(vault.EncryptedName) &&
		validSharedVaultEncryptedBlob(vault.EncryptedOwnerVaultKey) &&
		identity.ValidatePublicEncryptionKey(vault.ExpectedOwnerPublicKey) == nil
}

func validSharedVaultEncryptedBlob(value []byte) bool {
	return len(value) >= 13 && len(value) <= maxSharedVaultEncryptedBlobBytes
}

func copySharedVaultBytes(value []byte) []byte {
	return append([]byte(nil), value...)
}

var _ vaultapp.SharedVaultRepository = (*PostgresSharedVaultRepository)(nil)
