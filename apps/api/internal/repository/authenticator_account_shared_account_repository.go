package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	apiEntity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/postgres"
	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

const (
	sharedAccountOperationAdd     = "ADD"
	sharedAccountOperationEdit    = "EDIT"
	sharedAccountOperationDelete  = "DELETE"
	sharedAccountOperationMigrate = "MIGRATE"
)

type SharedAccountRepository struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewSharedAccountRepository(pool *pgxpool.Pool, now func() time.Time) (*SharedAccountRepository, error) {
	if pool == nil {
		return nil, errors.New("Shared Account repository is not configured")
	}
	if now == nil {
		now = time.Now
	}
	return &SharedAccountRepository{pool: pool, now: now}, nil
}

func (repository *SharedAccountRepository) Create(
	ctx context.Context,
	actorUserID string,
	vaultID string,
	encryptedPayload []byte,
	encryptionVersion int,
	expectedKeyVersion int64,
) (apiService.SharedAccountMutationResult, error) {
	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return apiService.SharedAccountMutationResult{}, fmt.Errorf("begin Shared Account creation: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	access, status, err := authorizeSharedAccountMutation(ctx, transaction, actorUserID, vaultID, sharedAccountOperationAdd, &expectedKeyVersion)
	if err != nil {
		return apiService.SharedAccountMutationResult{}, err
	}
	if status != apiService.SharedAccountMutationSuccess {
		return apiService.SharedAccountMutationResult{Status: status}, nil
	}
	accountID, err := postgres.NewCUID()
	if err != nil {
		return apiService.SharedAccountMutationResult{}, err
	}
	payload := append([]byte(nil), encryptedPayload...)
	defer clear(payload)
	now := repository.now()
	var storedPayload []byte
	var storedEncryptionVersion, revision int32
	if err := transaction.QueryRow(ctx, `
		INSERT INTO authenticator_accounts
			(id, vault_id, encrypted_payload, encryption_version, revision, created_at, updated_at)
		VALUES ($1, $2, $3, $4, 1, $5, $5)
		RETURNING encrypted_payload, encryption_version, revision`,
		accountID, vaultID, payload, encryptionVersion, now).Scan(&storedPayload, &storedEncryptionVersion, &revision); err != nil {
		return apiService.SharedAccountMutationResult{}, fmt.Errorf("create Shared Vault account: %w", err)
	}
	defer clear(storedPayload)
	account, err := apiEntity.NewEncryptedAuthenticatorAccount(accountID, vaultID, storedPayload, int(storedEncryptionVersion), int64(revision))
	if err != nil {
		return apiService.SharedAccountMutationResult{}, err
	}
	if err := appendSharedAccountAudit(ctx, transaction, access.vault, actorUserID, apiEntity.ActionAccountAdded, accountID); err != nil {
		account.Clear()
		return apiService.SharedAccountMutationResult{}, err
	}
	if err := transaction.Commit(ctx); err != nil {
		account.Clear()
		return apiService.SharedAccountMutationResult{}, fmt.Errorf("commit Shared Account creation: %w", err)
	}
	return apiService.SharedAccountMutationResult{Status: apiService.SharedAccountMutationSuccess, Account: &account}, nil
}

func (repository *SharedAccountRepository) MigratePayload(
	ctx context.Context,
	actorUserID string,
	vaultID string,
	accountID string,
	expectedRevision int64,
	expectedKeyVersion int64,
	migration sharedapp.EncryptedPayloadMigration,
) (sharedapp.EncryptedPayloadMigrationResult, error) {
	if actorUserID == "" || vaultID == "" || accountID == "" || expectedRevision < 1 || expectedKeyVersion < 1 {
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
		return "", fmt.Errorf("begin Shared Account payload migration: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	_, status, err := authorizeSharedAccountMutation(ctx, transaction, actorUserID, vaultID, sharedAccountOperationMigrate, &expectedKeyVersion)
	if err != nil {
		return "", err
	}
	if status != apiService.SharedAccountMutationSuccess {
		return sharedapp.EncryptedPayloadMigrationConflict, nil
	}
	var accountVaultID string
	var current []byte
	var encryptionVersion, revision int32
	err = transaction.QueryRow(ctx, `
		SELECT vault_id, encrypted_payload, encryption_version, revision
		FROM authenticator_accounts
		WHERE id = $1 AND deleted_at IS NULL`, accountID).
		Scan(&accountVaultID, &current, &encryptionVersion, &revision)
	if errors.Is(err, pgx.ErrNoRows) {
		return sharedapp.EncryptedPayloadMigrationConflict, nil
	}
	if err != nil {
		return "", fmt.Errorf("load Shared Account migration source: %w", err)
	}
	defer clear(current)
	if accountVaultID != vaultID || encryptionVersion != 1 {
		return sharedapp.EncryptedPayloadMigrationConflict, nil
	}
	currentDigest := sharedapp.SHA256Base64URL(current)
	if currentDigest == migration.ReplacementCiphertextDigest {
		if err := transaction.Commit(ctx); err != nil {
			return "", fmt.Errorf("commit Shared Account migration replay: %w", err)
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
		return "", fmt.Errorf("update Shared Account ciphertext: %w", err)
	}
	if command.RowsAffected() != 1 {
		return sharedapp.EncryptedPayloadMigrationConflict, nil
	}
	if err := transaction.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit Shared Account payload migration: %w", err)
	}
	return sharedapp.EncryptedPayloadMigrationCommitted, nil
}

func (repository *SharedAccountRepository) Update(
	ctx context.Context,
	actorUserID string,
	vaultID string,
	accountID string,
	expectedRevision int64,
	encryptedPayload []byte,
	encryptionVersion int,
	expectedKeyVersion int64,
) (apiService.SharedAccountMutationResult, error) {
	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return apiService.SharedAccountMutationResult{}, fmt.Errorf("begin Shared Account update: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	access, status, err := authorizeSharedAccountMutation(ctx, transaction, actorUserID, vaultID, sharedAccountOperationEdit, &expectedKeyVersion)
	if err != nil {
		return apiService.SharedAccountMutationResult{}, err
	}
	if status != apiService.SharedAccountMutationSuccess {
		return apiService.SharedAccountMutationResult{Status: status}, nil
	}
	payload := append([]byte(nil), encryptedPayload...)
	defer clear(payload)
	now := repository.now()
	var storedVaultID string
	var storedPayload []byte
	var storedEncryptionVersion, revision int32
	err = transaction.QueryRow(ctx, `
		UPDATE authenticator_accounts
		SET encrypted_payload = $1, encryption_version = $2, revision = revision + 1, updated_at = $3
		WHERE id = $4 AND vault_id = $5 AND revision = $6 AND deleted_at IS NULL
		RETURNING vault_id, encrypted_payload, encryption_version, revision`,
		payload, encryptionVersion, now, accountID, vaultID, expectedRevision).
		Scan(&storedVaultID, &storedPayload, &storedEncryptionVersion, &revision)
	if errors.Is(err, pgx.ErrNoRows) {
		return apiService.SharedAccountMutationResult{Status: apiService.SharedAccountMutationStaleRevision}, nil
	}
	if err != nil {
		return apiService.SharedAccountMutationResult{}, fmt.Errorf("update Shared Vault account: %w", err)
	}
	defer clear(storedPayload)
	account, err := apiEntity.NewEncryptedAuthenticatorAccount(accountID, storedVaultID, storedPayload, int(storedEncryptionVersion), int64(revision))
	if err != nil {
		return apiService.SharedAccountMutationResult{}, err
	}
	if err := appendSharedAccountAudit(ctx, transaction, access.vault, actorUserID, apiEntity.ActionAccountUpdated, accountID); err != nil {
		account.Clear()
		return apiService.SharedAccountMutationResult{}, err
	}
	if err := transaction.Commit(ctx); err != nil {
		account.Clear()
		return apiService.SharedAccountMutationResult{}, fmt.Errorf("commit Shared Account update: %w", err)
	}
	return apiService.SharedAccountMutationResult{Status: apiService.SharedAccountMutationSuccess, Account: &account}, nil
}

func (repository *SharedAccountRepository) Delete(
	ctx context.Context,
	actorUserID string,
	vaultID string,
	accountID string,
	expectedRevision int64,
) (apiService.SharedAccountMutationResult, error) {
	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return apiService.SharedAccountMutationResult{}, fmt.Errorf("begin Shared Account deletion: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	access, status, err := authorizeSharedAccountMutation(ctx, transaction, actorUserID, vaultID, sharedAccountOperationDelete, nil)
	if err != nil {
		return apiService.SharedAccountMutationResult{}, err
	}
	if status != apiService.SharedAccountMutationSuccess {
		return apiService.SharedAccountMutationResult{Status: status}, nil
	}
	deletedAt := repository.now()
	command, err := transaction.Exec(ctx, `
		UPDATE authenticator_accounts
		SET deleted_at = $1, purge_after = $2, revision = revision + 1, updated_at = $1
		WHERE id = $3 AND vault_id = $4 AND revision = $5 AND deleted_at IS NULL`,
		deletedAt, apiEntity.AccountPurgeAfter(deletedAt), accountID, vaultID, expectedRevision)
	if err != nil {
		return apiService.SharedAccountMutationResult{}, fmt.Errorf("delete Shared Vault account: %w", err)
	}
	if command.RowsAffected() != 1 {
		return apiService.SharedAccountMutationResult{Status: apiService.SharedAccountMutationStaleRevision}, nil
	}
	if err := appendSharedAccountAudit(ctx, transaction, access.vault, actorUserID, apiEntity.ActionAccountDeleted, accountID); err != nil {
		return apiService.SharedAccountMutationResult{}, err
	}
	if err := transaction.Commit(ctx); err != nil {
		return apiService.SharedAccountMutationResult{}, fmt.Errorf("commit Shared Account deletion: %w", err)
	}
	return apiService.SharedAccountMutationResult{Status: apiService.SharedAccountMutationSuccess}, nil
}

func (repository *SharedAccountRepository) Restore(
	ctx context.Context,
	actorUserID string,
	vaultID string,
	accountID string,
) (apiService.SharedAccountMutationResult, error) {
	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return apiService.SharedAccountMutationResult{}, fmt.Errorf("begin Shared Account restoration: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	vault, active, err := LockActiveSharedVault(ctx, transaction, vaultID)
	if err != nil {
		return apiService.SharedAccountMutationResult{}, err
	}
	if !active {
		return apiService.SharedAccountMutationResult{Status: apiService.SharedAccountMutationVaultUnavailable}, nil
	}
	if vault.OwnerID != actorUserID {
		return apiService.SharedAccountMutationResult{Status: apiService.SharedAccountMutationPermissionDenied}, nil
	}
	now := repository.now()
	legacyRecoveryCutoff := now.Add(-apiEntity.AccountRecoveryWindow)
	command, err := transaction.Exec(ctx, `
		UPDATE authenticator_accounts
		SET deleted_at = NULL, purge_after = NULL, revision = revision + 1, updated_at = $1
		WHERE id = $2 AND vault_id = $3 AND deleted_at IS NOT NULL
		  AND (purge_after > $1 OR (purge_after IS NULL AND deleted_at > $4))`,
		now, accountID, vaultID, legacyRecoveryCutoff)
	if err != nil {
		return apiService.SharedAccountMutationResult{}, fmt.Errorf("restore Shared Vault account: %w", err)
	}
	if command.RowsAffected() != 1 {
		return apiService.SharedAccountMutationResult{Status: apiService.SharedAccountMutationAccountUnavailable}, nil
	}
	if err := appendSharedAccountAudit(ctx, transaction, vault, actorUserID, apiEntity.ActionAccountRestored, accountID); err != nil {
		return apiService.SharedAccountMutationResult{}, err
	}
	if err := transaction.Commit(ctx); err != nil {
		return apiService.SharedAccountMutationResult{}, fmt.Errorf("commit Shared Account restoration: %w", err)
	}
	return apiService.SharedAccountMutationResult{Status: apiService.SharedAccountMutationSuccess}, nil
}

type authorizedSharedAccountMutation struct {
	vault ActiveSharedVault
}

func authorizeSharedAccountMutation(
	ctx context.Context,
	transaction pgx.Tx,
	actorUserID string,
	vaultID string,
	operation string,
	expectedKeyVersion *int64,
) (authorizedSharedAccountMutation, apiService.SharedAccountMutationStatus, error) {
	vault, active, err := LockActiveSharedVault(ctx, transaction, vaultID)
	if err != nil {
		return authorizedSharedAccountMutation{}, "", err
	}
	if !active {
		return authorizedSharedAccountMutation{}, apiService.SharedAccountMutationVaultUnavailable, nil
	}
	membership, active, err := LockActiveVaultMembership(ctx, transaction, vaultID, actorUserID)
	if err != nil {
		return authorizedSharedAccountMutation{}, "", err
	}
	if !active {
		return authorizedSharedAccountMutation{}, apiService.SharedAccountMutationVaultUnavailable, nil
	}
	if expectedKeyVersion != nil && (membership.KeyVersion == nil || *membership.KeyVersion != *expectedKeyVersion) {
		return authorizedSharedAccountMutation{}, apiService.SharedAccountMutationStaleKeyVersion, nil
	}
	if operation == sharedAccountOperationMigrate {
		return authorizedSharedAccountMutation{vault: vault}, apiService.SharedAccountMutationSuccess, nil
	}
	permissions := apiEntity.EffectiveSharedVaultAccountPermissionsFor(
		membership.Role,
		apiEntity.SharedVaultAccountPermissions{
			CanAddAccounts:    vault.MembersCanAddAccounts,
			CanEditAccounts:   vault.MembersCanEditAccounts,
			CanDeleteAccounts: vault.MembersCanDeleteAccounts,
		},
		membership.Overrides,
	)
	var permissionOperation apiEntity.SharedVaultAccountOperation
	switch operation {
	case sharedAccountOperationAdd:
		permissionOperation = apiEntity.SharedVaultAccountOperationAdd
	case sharedAccountOperationEdit:
		permissionOperation = apiEntity.SharedVaultAccountOperationEdit
	case sharedAccountOperationDelete:
		permissionOperation = apiEntity.SharedVaultAccountOperationDelete
	default:
		return authorizedSharedAccountMutation{}, "", errors.New("Shared Account operation is invalid")
	}
	if !apiEntity.CanPerformSharedVaultAccountOperation(permissions.Permissions, permissionOperation) {
		return authorizedSharedAccountMutation{}, apiService.SharedAccountMutationPermissionDenied, nil
	}
	return authorizedSharedAccountMutation{vault: vault}, apiService.SharedAccountMutationSuccess, nil
}

func appendSharedAccountAudit(
	ctx context.Context,
	transaction pgx.Tx,
	vault ActiveSharedVault,
	actorUserID string,
	action apiEntity.Action,
	accountID string,
) error {
	return AppendVaultAuditEvent(ctx, transaction, apiEntity.VaultAuditAppend{
		VaultID: vault.ID, OwnerID: vault.OwnerID, ActorUserID: actorUserID, Action: action, TargetID: accountID,
	})
}

var _ apiService.SharedAccountRepository = (*SharedAccountRepository)(nil)
