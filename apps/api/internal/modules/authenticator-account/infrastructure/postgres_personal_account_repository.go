package infrastructure

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/audit"
	accountapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/authenticator-account/application"
	accountdomain "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/authenticator-account/domain"
	vaultmanagement "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-management"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/postgres"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

type PostgresPersonalAccountRepository struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewPostgresPersonalAccountRepository(pool *pgxpool.Pool, now func() time.Time) (*PostgresPersonalAccountRepository, error) {
	if pool == nil {
		return nil, errors.New("Personal Account repository is not configured")
	}
	if now == nil {
		now = time.Now
	}
	return &PostgresPersonalAccountRepository{pool: pool, now: now}, nil
}

func (repository *PostgresPersonalAccountRepository) Create(ctx context.Context, ownerID string, vaultID string, input accountapp.NewEncryptedAccount) (accountdomain.EncryptedAuthenticatorAccount, error) {
	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return accountdomain.EncryptedAuthenticatorAccount{}, fmt.Errorf("begin Personal Account creation: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	_, active, err := vaultmanagement.LockActivePersonalVault(ctx, transaction, ownerID, vaultID)
	if err != nil {
		return accountdomain.EncryptedAuthenticatorAccount{}, err
	}
	if !active {
		return accountdomain.EncryptedAuthenticatorAccount{}, errors.New("Personal Vault is unavailable")
	}
	accountID, err := postgres.NewCUID()
	if err != nil {
		return accountdomain.EncryptedAuthenticatorAccount{}, err
	}
	payload := append([]byte(nil), input.EncryptedPayload...)
	defer clear(payload)
	now := repository.now()
	var storedPayload []byte
	var encryptionVersion int32
	var revision int32
	if err := transaction.QueryRow(ctx, `
		INSERT INTO authenticator_accounts
			(id, vault_id, encrypted_payload, encryption_version, revision, created_at, updated_at)
		VALUES ($1, $2, $3, $4, 1, $5, $5)
		RETURNING encrypted_payload, encryption_version, revision`,
		accountID, vaultID, payload, input.EncryptionVersion, now).Scan(&storedPayload, &encryptionVersion, &revision); err != nil {
		return accountdomain.EncryptedAuthenticatorAccount{}, fmt.Errorf("create Personal Vault account: %w", err)
	}
	defer clear(storedPayload)
	account, err := accountdomain.NewEncryptedAuthenticatorAccount(accountID, vaultID, storedPayload, int(encryptionVersion), int64(revision))
	if err != nil {
		return accountdomain.EncryptedAuthenticatorAccount{}, err
	}
	if input.Source == accountapp.AccountCopySourceLocalVault {
		if err := audit.AppendVaultAuditEvent(ctx, transaction, audit.VaultAuditAppend{
			VaultID: vaultID, OwnerID: ownerID, ActorUserID: ownerID,
			Action: audit.ActionAccountCopiedFromLocal, TargetID: accountID,
		}); err != nil {
			account.Clear()
			return accountdomain.EncryptedAuthenticatorAccount{}, err
		}
	}
	if err := transaction.Commit(ctx); err != nil {
		account.Clear()
		return accountdomain.EncryptedAuthenticatorAccount{}, fmt.Errorf("commit Personal Account creation: %w", err)
	}
	return account, nil
}

func (repository *PostgresPersonalAccountRepository) List(ctx context.Context, ownerID string, vaultID string) ([]accountdomain.EncryptedAuthenticatorAccount, error) {
	if err := vaultmanagement.AssertActivePersonalVault(ctx, repository.pool, ownerID, vaultID); err != nil {
		return nil, err
	}
	rows, err := repository.pool.Query(ctx, `
		SELECT id, vault_id, encrypted_payload, encryption_version, revision
		FROM authenticator_accounts
		WHERE vault_id = $1 AND deleted_at IS NULL
		ORDER BY created_at ASC`, vaultID)
	if err != nil {
		return nil, fmt.Errorf("list Personal Vault accounts: %w", err)
	}
	defer rows.Close()
	accounts := make([]accountdomain.EncryptedAuthenticatorAccount, 0)
	for rows.Next() {
		var id, storedVaultID string
		var payload []byte
		var encryptionVersion, revision int32
		if err := rows.Scan(&id, &storedVaultID, &payload, &encryptionVersion, &revision); err != nil {
			clear(payload)
			clearPersonalAccounts(accounts)
			return nil, fmt.Errorf("read Personal Vault account: %w", err)
		}
		account, err := accountdomain.NewEncryptedAuthenticatorAccount(id, storedVaultID, payload, int(encryptionVersion), int64(revision))
		clear(payload)
		if err != nil {
			clearPersonalAccounts(accounts)
			return nil, err
		}
		accounts = append(accounts, account)
	}
	if err := rows.Err(); err != nil {
		clearPersonalAccounts(accounts)
		return nil, fmt.Errorf("iterate Personal Vault accounts: %w", err)
	}
	return accounts, nil
}

func (repository *PostgresPersonalAccountRepository) MigratePayload(ctx context.Context, ownerID string, vaultID string, accountID string, expectedRevision int64, expectedKeyVersion int64, migration sharedapp.EncryptedPayloadMigration) (sharedapp.EncryptedPayloadMigrationResult, error) {
	if ownerID == "" || vaultID == "" || accountID == "" || expectedRevision < 1 || expectedKeyVersion < 1 {
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
		return "", fmt.Errorf("begin Personal Account payload migration: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	encryptionVersion, active, err := vaultmanagement.LockActivePersonalVault(ctx, transaction, ownerID, vaultID)
	if err != nil {
		return "", err
	}
	if !active || encryptionVersion != expectedKeyVersion {
		return sharedapp.EncryptedPayloadMigrationConflict, nil
	}
	var accountVaultID string
	var current []byte
	var revision int32
	err = transaction.QueryRow(ctx, `
		SELECT vault_id, encrypted_payload, revision
		FROM authenticator_accounts
		WHERE id = $1 AND deleted_at IS NULL`, accountID).Scan(&accountVaultID, &current, &revision)
	if errors.Is(err, pgx.ErrNoRows) {
		return sharedapp.EncryptedPayloadMigrationConflict, nil
	}
	if err != nil {
		return "", fmt.Errorf("load Personal Account migration source: %w", err)
	}
	defer clear(current)
	if accountVaultID != vaultID {
		return sharedapp.EncryptedPayloadMigrationConflict, nil
	}
	currentDigest := sharedapp.SHA256Base64URL(current)
	if currentDigest == migration.ReplacementCiphertextDigest {
		if err := transaction.Commit(ctx); err != nil {
			return "", fmt.Errorf("commit Personal Account migration replay: %w", err)
		}
		return sharedapp.EncryptedPayloadMigrationAlreadyCommitted, nil
	}
	if int64(revision) != expectedRevision || len(current) == 0 ||
		current[0] != byte(migration.ExpectedEnvelopeVersion) || currentDigest != migration.ExpectedCiphertextDigest {
		return sharedapp.EncryptedPayloadMigrationConflict, nil
	}
	command, err := transaction.Exec(ctx, `
		UPDATE authenticator_accounts
		SET encrypted_payload = $2, updated_at = $3
		WHERE id = $1 AND vault_id = $4 AND revision = $5 AND deleted_at IS NULL AND encrypted_payload = $6`,
		accountID, replacement, repository.now(), vaultID, expectedRevision, current)
	if err != nil {
		return "", fmt.Errorf("update Personal Account ciphertext: %w", err)
	}
	if command.RowsAffected() != 1 {
		return sharedapp.EncryptedPayloadMigrationConflict, nil
	}
	if err := transaction.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit Personal Account payload migration: %w", err)
	}
	return sharedapp.EncryptedPayloadMigrationCommitted, nil
}

func (repository *PostgresPersonalAccountRepository) Update(ctx context.Context, ownerID string, vaultID string, accountID string, expectedRevision int64, input accountapp.NewEncryptedAccount) (*accountdomain.EncryptedAuthenticatorAccount, error) {
	if err := vaultmanagement.AssertActivePersonalVault(ctx, repository.pool, ownerID, vaultID); err != nil {
		return nil, err
	}
	payload := append([]byte(nil), input.EncryptedPayload...)
	defer clear(payload)
	command, err := repository.pool.Exec(ctx, `
		UPDATE authenticator_accounts
		SET encrypted_payload = $1, encryption_version = $2, revision = revision + 1, updated_at = $3
		WHERE id = $4 AND vault_id = $5 AND revision = $6 AND deleted_at IS NULL`,
		payload, input.EncryptionVersion, repository.now(), accountID, vaultID, expectedRevision)
	if err != nil {
		return nil, fmt.Errorf("update Personal Vault account: %w", err)
	}
	if command.RowsAffected() != 1 {
		return nil, nil
	}
	var storedVaultID string
	var storedPayload []byte
	var encryptionVersion, revision int32
	if err := repository.pool.QueryRow(ctx, `
		SELECT vault_id, encrypted_payload, encryption_version, revision
		FROM authenticator_accounts WHERE id = $1`, accountID).
		Scan(&storedVaultID, &storedPayload, &encryptionVersion, &revision); err != nil {
		clear(storedPayload)
		return nil, fmt.Errorf("load updated Personal Vault account: %w", err)
	}
	defer clear(storedPayload)
	account, err := accountdomain.NewEncryptedAuthenticatorAccount(accountID, storedVaultID, storedPayload, int(encryptionVersion), int64(revision))
	if err != nil {
		return nil, err
	}
	return &account, nil
}

func (repository *PostgresPersonalAccountRepository) Delete(ctx context.Context, ownerID string, vaultID string, accountID string, expectedRevision int64) (bool, error) {
	if err := vaultmanagement.AssertActivePersonalVault(ctx, repository.pool, ownerID, vaultID); err != nil {
		return false, err
	}
	deletedAt := repository.now()
	command, err := repository.pool.Exec(ctx, `
		UPDATE authenticator_accounts
		SET deleted_at = $1, purge_after = $2, revision = revision + 1, updated_at = $1
		WHERE id = $3 AND vault_id = $4 AND revision = $5 AND deleted_at IS NULL`,
		deletedAt, accountdomain.AccountPurgeAfter(deletedAt), accountID, vaultID, expectedRevision)
	if err != nil {
		return false, fmt.Errorf("delete Personal Vault account: %w", err)
	}
	return command.RowsAffected() == 1, nil
}

func (repository *PostgresPersonalAccountRepository) Restore(ctx context.Context, ownerID string, vaultID string, accountID string) (bool, error) {
	if err := vaultmanagement.AssertActivePersonalVault(ctx, repository.pool, ownerID, vaultID); err != nil {
		return false, err
	}
	now := repository.now()
	legacyRecoveryCutoff := now.Add(-accountdomain.AccountRecoveryWindow)
	command, err := repository.pool.Exec(ctx, `
		UPDATE authenticator_accounts
		SET deleted_at = NULL, purge_after = NULL, revision = revision + 1, updated_at = $1
		WHERE id = $2 AND vault_id = $3 AND deleted_at IS NOT NULL
		  AND (purge_after > $1 OR (purge_after IS NULL AND deleted_at > $4))`,
		now, accountID, vaultID, legacyRecoveryCutoff)
	if err != nil {
		return false, fmt.Errorf("restore Personal Vault account: %w", err)
	}
	return command.RowsAffected() == 1, nil
}

func clearPersonalAccounts(accounts []accountdomain.EncryptedAuthenticatorAccount) {
	for index := range accounts {
		accounts[index].Clear()
	}
}

var _ accountapp.PersonalAccountRepository = (*PostgresPersonalAccountRepository)(nil)
