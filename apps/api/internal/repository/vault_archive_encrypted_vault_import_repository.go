package repository

import (
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
	if request.Destination.Kind == apiEntity.DestinationNewShared && found {
		return replayResult(ctx, transaction, request, true)
	}
	existingAccounts, err := readExistingAccountVaults(ctx, transaction, request.Accounts)
	if err != nil {
		return apiEntity.EncryptedVaultImportResult{}, err
	}
	if len(existingAccounts) > 0 {
		allFromDestination := len(existingAccounts) == len(request.Accounts)
		for _, existingVaultID := range existingAccounts {
			if existingVaultID != request.Destination.VaultID() {
				allFromDestination = false
				break
			}
		}
		if allFromDestination && (request.Destination.Kind != apiEntity.DestinationNewShared || found) {
			return apiEntity.EncryptedVaultImportResult{
				Status:       apiEntity.ImportStatusReplayed,
				VaultID:      request.Destination.VaultID(),
				AccountIDs:   importedAccountIDs(request.Accounts),
				VaultCreated: request.Destination.Kind == apiEntity.DestinationNewShared,
			}, nil
		}
		return apiEntity.EncryptedVaultImportResult{Status: apiEntity.ImportStatusConflict}, nil
	}
	if request.Destination.Kind == apiEntity.DestinationExisting && request.Destination.Existing.VaultType == "SHARED" &&
		(destination.keyVersion == nil || *destination.keyVersion != *request.Destination.Existing.ExpectedKeyVersion) {
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

func readExistingAccountVaults(ctx context.Context, transaction pgx.Tx, accounts []apiEntity.EncryptedImportedAccount) ([]string, error) {
	if len(accounts) == 0 {
		return []string{}, nil
	}
	ids := make([]string, 0, len(accounts))
	for _, account := range accounts {
		ids = append(ids, account.ID)
	}
	rows, err := transaction.Query(ctx, `SELECT vault_id FROM authenticator_accounts WHERE id = ANY($1::text[])`, ids)
	if err != nil {
		return nil, fmt.Errorf("check encrypted Vault import account identifiers: %w", err)
	}
	defer rows.Close()
	vaultIDs := make([]string, 0, len(ids))
	for rows.Next() {
		var vaultID string
		if err := rows.Scan(&vaultID); err != nil {
			return nil, fmt.Errorf("scan existing encrypted Vault import account: %w", err)
		}
		vaultIDs = append(vaultIDs, vaultID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate existing encrypted Vault import accounts: %w", err)
	}
	return vaultIDs, nil
}

func replayResult(
	ctx context.Context,
	transaction pgx.Tx,
	request apiEntity.EncryptedVaultImport,
	vaultCreated bool,
) (apiEntity.EncryptedVaultImportResult, error) {
	vaultID := request.Destination.VaultID()
	rows, err := transaction.Query(ctx, `
		SELECT id FROM authenticator_accounts
		WHERE id = ANY($1::text[]) AND vault_id = $2`, importedAccountIDs(request.Accounts), vaultID)
	if err != nil {
		return apiEntity.EncryptedVaultImportResult{}, fmt.Errorf("check new Shared Vault archive replay: %w", err)
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		var accountID string
		if err := rows.Scan(&accountID); err != nil {
			return apiEntity.EncryptedVaultImportResult{}, fmt.Errorf("scan replayed Vault archive account: %w", err)
		}
		count++
	}
	if err := rows.Err(); err != nil {
		return apiEntity.EncryptedVaultImportResult{}, fmt.Errorf("iterate replayed Vault archive accounts: %w", err)
	}
	if count != len(request.Accounts) {
		return apiEntity.EncryptedVaultImportResult{Status: apiEntity.ImportStatusConflict}, nil
	}
	return apiEntity.EncryptedVaultImportResult{
		Status: apiEntity.ImportStatusReplayed, VaultID: vaultID,
		AccountIDs: importedAccountIDs(request.Accounts), VaultCreated: vaultCreated,
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
		VALUES ($1, $2, 'OWNER', 'ACTIVE', $3, 1, $4, $4)`, destination.VaultID, actorUserID, destination.EncryptedOwnerVaultKey, now); err != nil {
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
	authorized, err := repository.currentlyAuthorized(ctx, actorUserID, request.Destination)
	if err != nil {
		return apiEntity.EncryptedVaultImportResult{}, err
	}
	if !authorized {
		return apiEntity.EncryptedVaultImportResult{Status: apiEntity.ImportStatusConflict}, nil
	}
	rows, err := repository.pool.Query(ctx, `
		SELECT id FROM authenticator_accounts WHERE id = ANY($1::text[]) AND vault_id = $2`,
		importedAccountIDs(request.Accounts), request.Destination.VaultID())
	if err != nil {
		return apiEntity.EncryptedVaultImportResult{}, fmt.Errorf("recheck authorization for encrypted Vault import replay: %w", err)
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		var accountID string
		if err := rows.Scan(&accountID); err != nil {
			return apiEntity.EncryptedVaultImportResult{}, fmt.Errorf("scan replayed encrypted Vault import: %w", err)
		}
		count++
	}
	if err := rows.Err(); err != nil {
		return apiEntity.EncryptedVaultImportResult{}, fmt.Errorf("iterate replayed encrypted Vault import: %w", err)
	}
	if count != len(request.Accounts) {
		return apiEntity.EncryptedVaultImportResult{Status: apiEntity.ImportStatusConflict}, nil
	}
	return apiEntity.EncryptedVaultImportResult{
		Status: apiEntity.ImportStatusReplayed, VaultID: request.Destination.VaultID(),
		AccountIDs: importedAccountIDs(request.Accounts), VaultCreated: request.Destination.Kind == apiEntity.DestinationNewShared,
	}, nil
}

func (repository *EncryptedVaultImportRepository) currentlyAuthorized(
	ctx context.Context,
	actorUserID string,
	destination apiEntity.Destination,
) (bool, error) {
	vaultID := destination.VaultID()
	vaultType := destination.VaultType()
	var ownerID string
	var membersCanAdd, membersCanEdit, membersCanDelete bool
	err := repository.pool.QueryRow(ctx, `
		SELECT owner_id, members_can_add_accounts, members_can_edit_accounts, members_can_delete_accounts
		FROM vaults WHERE id = $1 AND type = $2 AND lifecycle = 'ACTIVE' AND deleted_at IS NULL`, vaultID, vaultType).
		Scan(&ownerID, &membersCanAdd, &membersCanEdit, &membersCanDelete)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("recheck encrypted Vault import destination: %w", err)
	}
	if ownerID == actorUserID {
		return true, nil
	}
	if destination.Kind != apiEntity.DestinationExisting || vaultType != "SHARED" {
		return false, nil
	}
	var canAdd, canEdit, canDelete pgtype.Bool
	err = repository.pool.QueryRow(ctx, `
		SELECT can_add_accounts_override, can_edit_accounts_override, can_delete_accounts_override
		FROM vault_members WHERE vault_id = $1 AND user_id = $2 AND role = 'VIEWER' AND status = 'ACTIVE'`,
		vaultID, actorUserID).Scan(&canAdd, &canEdit, &canDelete)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("recheck Shared Vault import permission: %w", err)
	}
	permissions := apiEntity.EffectiveSharedVaultAccountPermissionsFor(apiEntity.SharedVaultMemberRoleViewer,
		apiEntity.SharedVaultAccountPermissions{
			CanAddAccounts: membersCanAdd, CanEditAccounts: membersCanEdit, CanDeleteAccounts: membersCanDelete,
		}, apiEntity.SharedVaultAccountPermissionOverrides{
			CanAddAccounts: nullableImportPermission(canAdd), CanEditAccounts: nullableImportPermission(canEdit),
			CanDeleteAccounts: nullableImportPermission(canDelete),
		})
	return permissions.Permissions.CanAddAccounts, nil
}

func importedAccountIDs(accounts []apiEntity.EncryptedImportedAccount) []string {
	ids := make([]string, len(accounts))
	for index, account := range accounts {
		ids[index] = account.ID
	}
	return ids
}

func nullableImportPermission(value pgtype.Bool) *bool {
	if !value.Valid {
		return nil
	}
	permission := value.Bool
	return &permission
}

func isVaultArchiveUniqueViolation(err error) bool {
	var postgresError *pgconn.PgError
	return errors.As(err, &postgresError) && postgresError.Code == "23505"
}
