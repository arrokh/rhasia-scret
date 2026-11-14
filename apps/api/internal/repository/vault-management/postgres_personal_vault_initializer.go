package infrastructure

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/identity"
	vaultapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/vault-management"
)

const maxPersonalVaultEncryptedBlobBytes = 16*1024 + 29

type PostgresPersonalVaultInitializer struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewPostgresPersonalVaultInitializer(pool *pgxpool.Pool, now func() time.Time) (*PostgresPersonalVaultInitializer, error) {
	if pool == nil {
		return nil, errors.New("Personal Vault initializer is not configured")
	}
	if now == nil {
		now = time.Now
	}
	return &PostgresPersonalVaultInitializer{pool: pool, now: now}, nil
}

func (initializer *PostgresPersonalVaultInitializer) Initialize(ctx context.Context, ownerID string, initialization vaultapp.PersonalVaultInitialization) error {
	if !validPersonalVaultInitialization(ownerID, initialization) {
		return errors.New("Personal Vault initialization is invalid")
	}
	publicKey, err := json.Marshal(initialization.UserEncryptionPublicKey)
	if err != nil {
		return errors.New("Personal Vault initialization is invalid")
	}
	transaction, err := initializer.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin Personal Vault initialization: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	if _, err := transaction.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, ownerID); err != nil {
		return fmt.Errorf("lock Personal Vault initialization: %w", err)
	}
	var vaultID string
	var lifecycle string
	err = transaction.QueryRow(ctx, `
		SELECT id, lifecycle
		FROM vaults
		WHERE owner_id = $1 AND type = 'PERSONAL'
		ORDER BY created_at ASC
		LIMIT 1
		FOR UPDATE`, ownerID).Scan(&vaultID, &lifecycle)
	if errors.Is(err, pgx.ErrNoRows) {
		return errors.New("Personal Vault does not exist")
	}
	if err != nil {
		return fmt.Errorf("load Personal Vault for initialization: %w", err)
	}
	if lifecycle != "UNINITIALIZED" {
		return errors.New("Personal Vault is already initialized")
	}
	now := initializer.now()
	_, err = transaction.Exec(ctx, `
		INSERT INTO user_crypto_profiles (
			user_id, vault_unlock_salt, wrapped_user_root_key, root_key_wrapping_version,
			encrypted_personal_vault_key, personal_vault_key_encryption_version,
			user_encryption_public_key, encrypted_user_private_key, user_encryption_key_version,
			created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $4, $6::jsonb, $7, $8, $9, $9)`,
		ownerID, initialization.VaultUnlockSalt, initialization.WrappedUserRootKey, initialization.EncryptionVersion,
		initialization.EncryptedPersonalVaultKey, string(publicKey), initialization.EncryptedUserPrivateKey,
		initialization.UserEncryptionKeyVersion, now)
	if err != nil {
		return fmt.Errorf("create User Crypto Profile for Personal Vault initialization: %w", err)
	}
	command, err := transaction.Exec(ctx, `
		UPDATE vaults
		SET encrypted_name = $2, encryption_version = $3, lifecycle = 'ACTIVE', updated_at = $4
		WHERE id = $1 AND lifecycle = 'UNINITIALIZED'`,
		vaultID, initialization.EncryptedVaultName, initialization.EncryptionVersion, now)
	if err != nil {
		return fmt.Errorf("activate initialized Personal Vault: %w", err)
	}
	if command.RowsAffected() != 1 {
		return errors.New("Personal Vault changed during initialization")
	}
	if err := transaction.Commit(ctx); err != nil {
		return fmt.Errorf("commit Personal Vault initialization: %w", err)
	}
	return nil
}

func validPersonalVaultInitialization(ownerID string, initialization vaultapp.PersonalVaultInitialization) bool {
	return ownerID != "" && len(initialization.VaultUnlockSalt) == 16 &&
		validPersonalVaultEncryptedBlob(initialization.WrappedUserRootKey) &&
		validPersonalVaultEncryptedBlob(initialization.EncryptedPersonalVaultKey) &&
		validPersonalVaultEncryptedBlob(initialization.EncryptedVaultName) &&
		validPersonalVaultEncryptedBlob(initialization.EncryptedUserPrivateKey) &&
		initialization.EncryptionVersion == 1 && initialization.UserEncryptionKeyVersion == 1 &&
		identityapp.ValidateUserEncryptionPublicKey(initialization.UserEncryptionPublicKey) == nil
}

func validPersonalVaultEncryptedBlob(value []byte) bool {
	return len(value) >= 13 && len(value) <= maxPersonalVaultEncryptedBlobBytes
}

var _ vaultapp.PersonalVaultInitializer = (*PostgresPersonalVaultInitializer)(nil)
