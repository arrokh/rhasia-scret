package infrastructure

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	vaultdomain "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity/vault-management"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/postgres"
	vaultapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/vault-management"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

type PostgresPersonalVaultRepository struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewPostgresPersonalVaultRepository(pool *pgxpool.Pool, now func() time.Time) (*PostgresPersonalVaultRepository, error) {
	if pool == nil {
		return nil, errors.New("Personal Vault repository is not configured")
	}
	if now == nil {
		now = time.Now
	}
	return &PostgresPersonalVaultRepository{pool: pool, now: now}, nil
}

func (repository *PostgresPersonalVaultRepository) EnsureForOwner(ctx context.Context, ownerID string) (vaultdomain.Vault, error) {
	if ownerID == "" {
		return vaultdomain.Vault{}, errors.New("an application user is required to create a Personal Vault")
	}
	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return vaultdomain.Vault{}, fmt.Errorf("begin Personal Vault ensure: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	if _, err := transaction.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, ownerID); err != nil {
		return vaultdomain.Vault{}, fmt.Errorf("lock Personal Vault ensure: %w", err)
	}

	var record vaultRecord
	err = transaction.QueryRow(ctx, `
		SELECT id, type, owner_id, lifecycle
		FROM vaults
		WHERE owner_id = $1 AND type = 'PERSONAL'
		ORDER BY created_at ASC
		LIMIT 1`, ownerID).Scan(&record.ID, &record.Type, &record.OwnerID, &record.Lifecycle)
	if err == nil {
		vault, mapErr := record.toDomain()
		if mapErr != nil {
			return vaultdomain.Vault{}, mapErr
		}
		if err := transaction.Commit(ctx); err != nil {
			return vaultdomain.Vault{}, fmt.Errorf("commit Personal Vault ensure lookup: %w", err)
		}
		return vault, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return vaultdomain.Vault{}, fmt.Errorf("load Personal Vault for owner: %w", err)
	}

	vaultID, err := postgres.NewCUID()
	if err != nil {
		return vaultdomain.Vault{}, err
	}
	now := repository.now()
	if _, err := transaction.Exec(ctx, `
		INSERT INTO vaults (id, type, lifecycle, owner_id, encryption_version, created_at, updated_at)
		VALUES ($1, 'PERSONAL', 'UNINITIALIZED', $2, 1, $3, $3)`, vaultID, ownerID, now); err != nil {
		return vaultdomain.Vault{}, fmt.Errorf("create Personal Vault: %w", err)
	}
	if _, err := transaction.Exec(ctx, `
		INSERT INTO vault_members (vault_id, user_id, role, created_at, updated_at)
		VALUES ($1, $2, 'OWNER', $3, $3)`, vaultID, ownerID, now); err != nil {
		return vaultdomain.Vault{}, fmt.Errorf("create Personal Vault owner membership: %w", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return vaultdomain.Vault{}, fmt.Errorf("commit Personal Vault ensure: %w", err)
	}
	return vaultdomain.NewVault(vaultID, vaultdomain.VaultTypePersonal, ownerID, vaultdomain.VaultLifecycleUninitialized)
}

func (repository *PostgresPersonalVaultRepository) MigrateName(ctx context.Context, ownerID string, vaultID string, expectedKeyVersion int64, migration sharedapp.EncryptedPayloadMigration) (sharedapp.EncryptedPayloadMigrationResult, error) {
	if ownerID == "" || vaultID == "" || expectedKeyVersion < 1 {
		return sharedapp.EncryptedPayloadMigrationConflict, nil
	}
	replacement := append([]byte(nil), migration.ReplacementCiphertext...)
	defer clear(replacement)
	migration.ReplacementCiphertext = replacement
	if !sharedapp.ValidateEncryptedPayloadMigration(migration) {
		return sharedapp.EncryptedPayloadMigrationConflict, nil
	}

	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return "", fmt.Errorf("begin Personal Vault name migration: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	if _, err := transaction.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, ownerID); err != nil {
		return "", fmt.Errorf("lock Personal Vault name migration: %w", err)
	}
	var current []byte
	var encryptionVersion int32
	err = transaction.QueryRow(ctx, `
		SELECT encrypted_name, encryption_version
		FROM vaults
		WHERE id = $1 AND owner_id = $2 AND type = 'PERSONAL' AND lifecycle = 'ACTIVE' AND deleted_at IS NULL`,
		vaultID, ownerID).Scan(&current, &encryptionVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return sharedapp.EncryptedPayloadMigrationConflict, nil
	}
	if err != nil {
		return "", fmt.Errorf("load Personal Vault name migration source: %w", err)
	}
	defer clear(current)
	if len(current) == 0 || int64(encryptionVersion) != expectedKeyVersion {
		return sharedapp.EncryptedPayloadMigrationConflict, nil
	}
	currentDigest := sharedapp.SHA256Base64URL(current)
	if currentDigest == migration.ReplacementCiphertextDigest {
		if err := transaction.Commit(ctx); err != nil {
			return "", fmt.Errorf("commit Personal Vault name migration replay: %w", err)
		}
		return sharedapp.EncryptedPayloadMigrationAlreadyCommitted, nil
	}
	if current[0] != byte(migration.ExpectedEnvelopeVersion) || currentDigest != migration.ExpectedCiphertextDigest {
		return sharedapp.EncryptedPayloadMigrationConflict, nil
	}
	command, err := transaction.Exec(ctx, `
		UPDATE vaults
		SET encrypted_name = $2, updated_at = $3
		WHERE id = $1 AND owner_id = $4 AND type = 'PERSONAL' AND lifecycle = 'ACTIVE'
		  AND deleted_at IS NULL AND encryption_version = $5 AND encrypted_name = $6`,
		vaultID, replacement, repository.now(), ownerID, expectedKeyVersion, current)
	if err != nil {
		return "", fmt.Errorf("update encrypted Personal Vault name: %w", err)
	}
	if command.RowsAffected() != 1 {
		return sharedapp.EncryptedPayloadMigrationConflict, nil
	}
	if err := transaction.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit Personal Vault name migration: %w", err)
	}
	return sharedapp.EncryptedPayloadMigrationCommitted, nil
}

type vaultRecord struct {
	ID        string
	Type      string
	OwnerID   string
	Lifecycle string
}

func (record vaultRecord) toDomain() (vaultdomain.Vault, error) {
	return vaultdomain.NewVault(record.ID, vaultdomain.VaultType(record.Type), record.OwnerID, vaultdomain.VaultLifecycle(record.Lifecycle))
}

var _ vaultapp.PersonalVaultRepository = (*PostgresPersonalVaultRepository)(nil)
