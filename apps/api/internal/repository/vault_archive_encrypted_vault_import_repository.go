package repository

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	apiEntity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity"
)

const initialSharedVaultMemberKeyVersion int32 = 1

type EncryptedVaultImportRepository struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewEncryptedVaultImportRepository(pool *pgxpool.Pool, now func() time.Time) (*EncryptedVaultImportRepository, error) {
	if pool == nil {
		return nil, errors.New("encrypted Vault import repository is not configured")
	}
	if now == nil {
		now = time.Now
	}
	return &EncryptedVaultImportRepository{pool: pool, now: now}, nil
}

type authorizedImportDestination struct {
	vaultID                  string
	ownerID                  string
	vaultType                string
	membersCanAddAccounts    bool
	membersCanEditAccounts   bool
	membersCanDeleteAccounts bool
	keyVersion               *int64
}

func (repository *EncryptedVaultImportRepository) Import(
	ctx context.Context,
	actorUserID string,
	request apiEntity.EncryptedVaultImport,
) (apiEntity.EncryptedVaultImportResult, error) {
	if actorUserID == "" {
		return apiEntity.EncryptedVaultImportResult{}, errors.New("encrypted Vault import actor is missing")
	}
	if apiEntity.HasDuplicateImportedAccountIDs(request.Accounts) {
		return apiEntity.EncryptedVaultImportResult{Status: apiEntity.ImportStatusConflict}, nil
	}
	if err := apiEntity.ValidateEncryptedVaultImport(request); err != nil {
		return apiEntity.EncryptedVaultImportResult{}, err
	}
	transaction, err := repository.pool.Begin(ctx)
	if err != nil {
		return apiEntity.EncryptedVaultImportResult{}, fmt.Errorf("begin encrypted Vault archive import: %w", err)
	}
	result, importErr := repository.importInTransaction(ctx, transaction, actorUserID, request)
	if importErr != nil {
		_ = transaction.Rollback(ctx)
		if isVaultArchiveUniqueViolation(importErr) {
			return repository.readReplayOrConflict(ctx, actorUserID, request)
		}
		return apiEntity.EncryptedVaultImportResult{}, importErr
	}
	if err := transaction.Commit(ctx); err != nil {
		if isVaultArchiveUniqueViolation(err) {
			return repository.readReplayOrConflict(ctx, actorUserID, request)
		}
		return apiEntity.EncryptedVaultImportResult{}, fmt.Errorf("commit encrypted Vault archive import: %w", err)
	}
	return result, nil
}

func (repository *EncryptedVaultImportRepository) importInTransaction(
	ctx context.Context,
	transaction pgx.Tx,
	actorUserID string,
	request apiEntity.EncryptedVaultImport,
) (apiEntity.EncryptedVaultImportResult, error) {
	if request.Destination.Kind == apiEntity.DestinationNewShared {
		if _, err := transaction.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, actorUserID); err != nil {
			return apiEntity.EncryptedVaultImportResult{}, fmt.Errorf("serialize new Shared Vault archive imports: %w", err)
		}
	}
	destination, found, err := lockAuthorizedImportDestination(ctx, transaction, actorUserID, request.Destination)
	if err != nil {
		return apiEntity.EncryptedVaultImportResult{}, err
	}
	if request.Destination.Kind == apiEntity.DestinationExisting && !found {
		return apiEntity.EncryptedVaultImportResult{Status: apiEntity.ImportStatusDestinationUnavailable}, nil
	}
	if request.Destination.Kind == apiEntity.DestinationExisting && request.Destination.Existing.VaultType == "SHARED" &&
		!sharedImportKeyVersionMatches(destination, request.Destination.Existing.ExpectedKeyVersion) {
		return apiEntity.EncryptedVaultImportResult{Status: apiEntity.ImportStatusConflict}, nil
	}
	if request.Destination.Kind == apiEntity.DestinationNewShared && found {
		return replayResult(ctx, transaction, actorUserID, request)
	}
	existingCount, exactReplay, err := readExistingImportedAccounts(ctx, transaction, request.Destination.VaultID(), request.Accounts)
	if err != nil {
		return apiEntity.EncryptedVaultImportResult{}, err
	}
	if existingCount > 0 {
		if exactReplay && existingCount == len(request.Accounts) &&
			(request.Destination.Kind != apiEntity.DestinationNewShared || found) {
			return apiEntity.EncryptedVaultImportResult{
				Status:     apiEntity.ImportStatusReplayed,
				VaultID:    request.Destination.VaultID(),
				AccountIDs: importedAccountIDs(request.Accounts),
			}, nil
		}
		return apiEntity.EncryptedVaultImportResult{Status: apiEntity.ImportStatusConflict}, nil
	}
	if request.Destination.Kind == apiEntity.DestinationNewShared {
		matches, err := MatchesUserEncryptionPublicKey(ctx, transaction, actorUserID, request.Destination.NewShared.ExpectedOwnerPublicKey)
		if err != nil {
			return apiEntity.EncryptedVaultImportResult{}, err
		}
		if !matches {
			return apiEntity.EncryptedVaultImportResult{Status: apiEntity.ImportStatusConflict}, nil
		}
		if err := repository.createSharedVaultAndAccounts(ctx, transaction, actorUserID, request); err != nil {
			return apiEntity.EncryptedVaultImportResult{}, err
		}
	} else {
		if err := repository.createAccounts(ctx, transaction, request); err != nil {
			return apiEntity.EncryptedVaultImportResult{}, err
		}
		if err := AppendVaultAuditEvent(ctx, transaction, apiEntity.VaultAuditAppend{
			VaultID:     destination.vaultID,
			OwnerID:     destination.ownerID,
			ActorUserID: actorUserID,
			Action:      apiEntity.ActionArchiveImported,
		}); err != nil {
			return apiEntity.EncryptedVaultImportResult{}, err
		}
	}
	return apiEntity.EncryptedVaultImportResult{
		Status:       apiEntity.ImportStatusImported,
		VaultID:      request.Destination.VaultID(),
		AccountIDs:   importedAccountIDs(request.Accounts),
		VaultCreated: request.Destination.Kind == apiEntity.DestinationNewShared,
	}, nil
}

func lockAuthorizedImportDestination(
	ctx context.Context,
	transaction pgx.Tx,
	actorUserID string,
	destination apiEntity.Destination,
) (authorizedImportDestination, bool, error) {
	if destination.Kind == apiEntity.DestinationExisting && destination.Existing.VaultType == "PERSONAL" {
		_, found, err := LockActivePersonalVault(ctx, transaction, actorUserID, destination.Existing.VaultID)
		if err != nil || !found {
			return authorizedImportDestination{}, false, err
		}
		return authorizedImportDestination{
			vaultID: destination.Existing.VaultID, ownerID: actorUserID, vaultType: "PERSONAL",
		}, true, nil
	}
	vaultID := destination.VaultID()
	vault, found, err := LockActiveSharedVault(ctx, transaction, vaultID)
	if err != nil || !found {
		return authorizedImportDestination{}, false, err
	}
	membership, memberFound, err := LockActiveVaultMembership(ctx, transaction, vaultID, actorUserID)
	if err != nil || !memberFound {
		return authorizedImportDestination{}, false, err
	}
	if vault.OwnerID == actorUserID {
		if membership.Role != apiEntity.SharedVaultMemberRoleOwner {
			return authorizedImportDestination{}, false, nil
		}
	} else {
		if destination.Kind != apiEntity.DestinationExisting || membership.Role != apiEntity.SharedVaultMemberRoleViewer {
			return authorizedImportDestination{}, false, nil
		}
		permissions := apiEntity.EffectiveSharedVaultAccountPermissionsFor(membership.Role,
			apiEntity.SharedVaultAccountPermissions{
				CanAddAccounts:    vault.MembersCanAddAccounts,
				CanEditAccounts:   vault.MembersCanEditAccounts,
				CanDeleteAccounts: vault.MembersCanDeleteAccounts,
			}, membership.Overrides)
		if !permissions.Permissions.CanAddAccounts {
			return authorizedImportDestination{}, false, nil
		}
	}
	return authorizedImportDestination{
		vaultID: vault.ID, ownerID: vault.OwnerID, vaultType: "SHARED",
		membersCanAddAccounts:    vault.MembersCanAddAccounts,
		membersCanEditAccounts:   vault.MembersCanEditAccounts,
		membersCanDeleteAccounts: vault.MembersCanDeleteAccounts,
		keyVersion:               membership.KeyVersion,
	}, true, nil
}

func sharedImportKeyVersionMatches(destination authorizedImportDestination, expected *int64) bool {
	return expected != nil && destination.keyVersion != nil && *destination.keyVersion == *expected
}

func readExistingImportedAccounts(
	ctx context.Context,
	transaction pgx.Tx,
	destinationVaultID string,
	accounts []apiEntity.EncryptedImportedAccount,
) (int, bool, error) {
	requested := make(map[string]apiEntity.EncryptedImportedAccount, len(accounts))
	for _, account := range accounts {
		requested[account.ID] = account
	}
	rows, err := transaction.Query(ctx, `
		SELECT id, vault_id, encrypted_payload, encryption_version, deleted_at
		FROM authenticator_accounts
		WHERE id = ANY($1::text[])
		ORDER BY id
		FOR UPDATE`, importedAccountIDs(accounts))
	if err != nil {
		return 0, false, fmt.Errorf("check encrypted Vault import replay content: %w", err)
	}
	defer rows.Close()
	existingCount := 0
	exactReplay := true
	for rows.Next() {
		var id, vaultID string
		var payload []byte
		var encryptionVersion int32
		var deletedAt pgtype.Timestamptz
		if err := rows.Scan(&id, &vaultID, &payload, &encryptionVersion, &deletedAt); err != nil {
			clear(payload)
			return 0, false, fmt.Errorf("scan encrypted Vault import replay content: %w", err)
		}
		existingCount++
		requestedAccount, found := requested[id]
		if !found || vaultID != destinationVaultID || deletedAt.Valid ||
			encryptionVersion != int32(requestedAccount.EncryptionVersion) || !bytes.Equal(payload, requestedAccount.EncryptedPayload) {
			exactReplay = false
		}
		clear(payload)
	}
	if err := rows.Err(); err != nil {
		return 0, false, fmt.Errorf("iterate encrypted Vault import replay content: %w", err)
	}
	return existingCount, exactReplay, nil
}

func existingNewSharedVaultMatches(
	ctx context.Context,
	transaction pgx.Tx,
	ownerID string,
	destination apiEntity.NewSharedVaultDestination,
) (bool, error) {
	var encryptedName, encryptedOwnerVaultKey []byte
	var encryptionVersion int32
	var keyVersion pgtype.Int4
	err := transaction.QueryRow(ctx, `
		SELECT vault.encrypted_name, vault.encryption_version, member.encrypted_vault_key, member.key_version
		FROM vaults AS vault
		JOIN vault_members AS member ON member.vault_id = vault.id
		WHERE vault.id = $1 AND vault.owner_id = $2 AND vault.type = 'SHARED'
		  AND vault.lifecycle = 'ACTIVE' AND vault.deleted_at IS NULL
		  AND member.user_id = $2 AND member.role = 'OWNER' AND member.status = 'ACTIVE'`,
		destination.VaultID, ownerID).Scan(&encryptedName, &encryptionVersion, &encryptedOwnerVaultKey, &keyVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		clear(encryptedName)
		clear(encryptedOwnerVaultKey)
		return false, nil
	}
	if err != nil {
		clear(encryptedName)
		clear(encryptedOwnerVaultKey)
		return false, fmt.Errorf("read existing Shared Vault archive destination: %w", err)
	}
	defer clear(encryptedName)
	defer clear(encryptedOwnerVaultKey)
	return bytes.Equal(encryptedName, destination.EncryptedName) &&
		bytes.Equal(encryptedOwnerVaultKey, destination.EncryptedOwnerVaultKey) &&
		encryptionVersion == int32(destination.EncryptionVersion) &&
		keyVersion.Valid && keyVersion.Int32 == initialSharedVaultMemberKeyVersion, nil
}

func replayResult(
	ctx context.Context,
	transaction pgx.Tx,
	actorUserID string,
	request apiEntity.EncryptedVaultImport,
) (apiEntity.EncryptedVaultImportResult, error) {
	vaultID := request.Destination.VaultID()
	if request.Destination.Kind == apiEntity.DestinationNewShared {
		matchesIdentity, err := MatchesUserEncryptionPublicKey(ctx, transaction, actorUserID, request.Destination.NewShared.ExpectedOwnerPublicKey)
		if err != nil {
			return apiEntity.EncryptedVaultImportResult{}, err
		}
		if !matchesIdentity {
			return apiEntity.EncryptedVaultImportResult{Status: apiEntity.ImportStatusConflict}, nil
		}
		matchesVault, err := existingNewSharedVaultMatches(ctx, transaction, actorUserID, request.Destination.NewShared)
		if err != nil {
			return apiEntity.EncryptedVaultImportResult{}, err
		}
		if !matchesVault {
			return apiEntity.EncryptedVaultImportResult{Status: apiEntity.ImportStatusConflict}, nil
		}
	}
	existingCount, exactReplay, err := readExistingImportedAccounts(ctx, transaction, vaultID, request.Accounts)
	if err != nil {
		return apiEntity.EncryptedVaultImportResult{}, err
	}
	if existingCount != len(request.Accounts) || !exactReplay {
		return apiEntity.EncryptedVaultImportResult{Status: apiEntity.ImportStatusConflict}, nil
	}
	return apiEntity.EncryptedVaultImportResult{
		Status: apiEntity.ImportStatusReplayed, VaultID: vaultID,
		AccountIDs:   importedAccountIDs(request.Accounts),
		VaultCreated: request.Destination.Kind == apiEntity.DestinationNewShared,
	}, nil
}

func (repository *EncryptedVaultImportRepository) createSharedVaultAndAccounts(
	ctx context.Context,
	transaction pgx.Tx,
	actorUserID string,
	request apiEntity.EncryptedVaultImport,
) error {
	destination := request.Destination.NewShared
	now := repository.now()
	if _, err := transaction.Exec(ctx, `
		INSERT INTO vaults (id, type, lifecycle, owner_id, encrypted_name, encryption_version, created_at, updated_at)
		VALUES ($1, 'SHARED', 'ACTIVE', $2, $3, $4, $5, $5)`, destination.VaultID, actorUserID,
		destination.EncryptedName, destination.EncryptionVersion, now); err != nil {
		return fmt.Errorf("create Shared Vault from encrypted archive: %w", err)
	}
	if _, err := transaction.Exec(ctx, `
		INSERT INTO vault_members (vault_id, user_id, role, status, encrypted_vault_key, key_version, created_at, updated_at)
		VALUES ($1, $2, 'OWNER', 'ACTIVE', $3, $4, $5, $5)`, destination.VaultID, actorUserID,
		destination.EncryptedOwnerVaultKey, initialSharedVaultMemberKeyVersion, now); err != nil {
		return fmt.Errorf("create Shared Vault owner membership from archive: %w", err)
	}
	if err := repository.createAccounts(ctx, transaction, request); err != nil {
		return err
	}
	if err := AppendVaultAuditEvent(ctx, transaction, apiEntity.VaultAuditAppend{
		VaultID: destination.VaultID, OwnerID: actorUserID, ActorUserID: actorUserID, Action: apiEntity.ActionArchiveImported,
	}); err != nil {
		return err
	}
	return nil
}

func (repository *EncryptedVaultImportRepository) createAccounts(
	ctx context.Context,
	transaction pgx.Tx,
	request apiEntity.EncryptedVaultImport,
) error {
	vaultID := request.Destination.VaultID()
	now := repository.now()
	for _, account := range request.Accounts {
		if _, err := transaction.Exec(ctx, `
			INSERT INTO authenticator_accounts (id, vault_id, encrypted_payload, encryption_version, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $5)`, account.ID, vaultID, account.EncryptedPayload, account.EncryptionVersion, now); err != nil {
			return fmt.Errorf("create encrypted account from Vault archive: %w", err)
		}
	}
	return nil
}

func (repository *EncryptedVaultImportRepository) readReplayOrConflict(
	ctx context.Context,
	actorUserID string,
	request apiEntity.EncryptedVaultImport,
) (apiEntity.EncryptedVaultImportResult, error) {
	transaction, err := repository.pool.Begin(ctx)
	if err != nil {
		return apiEntity.EncryptedVaultImportResult{}, fmt.Errorf("begin encrypted Vault import replay verification: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	destination, authorized, err := lockAuthorizedImportDestination(ctx, transaction, actorUserID, request.Destination)
	if err != nil {
		return apiEntity.EncryptedVaultImportResult{}, err
	}
	if !authorized {
		return apiEntity.EncryptedVaultImportResult{Status: apiEntity.ImportStatusConflict}, nil
	}
	if request.Destination.Kind == apiEntity.DestinationExisting && request.Destination.Existing.VaultType == "SHARED" &&
		!sharedImportKeyVersionMatches(destination, request.Destination.Existing.ExpectedKeyVersion) {
		return apiEntity.EncryptedVaultImportResult{Status: apiEntity.ImportStatusConflict}, nil
	}
	result, err := replayResult(ctx, transaction, actorUserID, request)
	if err != nil {
		return apiEntity.EncryptedVaultImportResult{}, err
	}
	if result.Status != apiEntity.ImportStatusReplayed {
		return result, nil
	}
	if err := transaction.Commit(ctx); err != nil {
		return apiEntity.EncryptedVaultImportResult{}, fmt.Errorf("commit encrypted Vault import replay verification: %w", err)
	}
	return result, nil
}

func importedAccountIDs(accounts []apiEntity.EncryptedImportedAccount) []string {
	ids := make([]string, len(accounts))
	for index, account := range accounts {
		ids[index] = account.ID
	}
	return ids
}

func isVaultArchiveUniqueViolation(err error) bool {
	var postgresError *pgconn.PgError
	return errors.As(err, &postgresError) && postgresError.Code == "23505"
}
